import { z } from "zod";
import { getAuthedClient } from "@/lib/supabase/auth";
import { ok, unauthorized, notFound, fromZod, fail, serverError } from "@/lib/api";
import { computeReceiptTotals } from "@/lib/money";
import {
  insertReceiptDiscounts,
  isReceiptDiscountsUnavailable,
  normalizeDiscountRows,
  sumDiscountAmount,
} from "@/lib/receipt-discounts";
import { syncReceiptItems } from "@/lib/sync-receipt-items";
import { syncMovedToPalDebtsForGroup } from "@/lib/move-group-to-pal-debt";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;
    const { id } = await params;

    // RLS: creator or group member via can_access_receipt
    const { data: receipt, error } = await supabase
      .from("receipts")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) return fail(error.message, 400);
    if (!receipt) return notFound("Receipt not found");

    const canEdit = receipt.created_by === user.id;

    const [{ data: items }, { data: images }, { data: history }, discountsQuery] =
      await Promise.all([
      supabase
        .from("receipt_items")
        .select("*")
        .eq("receipt_id", id)
        .order("sort_order", { ascending: true }),
      supabase.from("receipt_images").select("*").eq("receipt_id", id),
      supabase
        .from("receipt_history")
        .select("*")
        .eq("receipt_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("receipt_discounts")
        .select("*")
        .eq("receipt_id", id)
        .order("sort_order", { ascending: true }),
    ]);

    const discountRows = isReceiptDiscountsUnavailable(discountsQuery.error)
      ? []
      : (discountsQuery.data ?? []);

    const discounts = normalizeDiscountRows(
      (discountRows ?? []).map((row) => ({
        id: row.id,
        label: row.label,
        amount: Number(row.amount),
        sort_order: row.sort_order,
      })),
      Number(receipt.discount)
    );

    // Prefer proxy so group members can always view the image (not only the uploader)
    let imageUrl: string | null = null;
    const path = images?.[0]?.storage_path;
    if (path) {
      imageUrl = `/api/receipts/${id}/image`;
    }

    return ok({
      receipt,
      items: items ?? [],
      discounts,
      images: images ?? [],
      history: history ?? [],
      imageUrl,
      canEdit,
    });
  } catch (error) {
    console.error(error);
    return serverError();
  }
}

const itemSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  quantity: z.number().positive(),
  unit_price: z.number().min(0),
  total_price: z.number().min(0),
  sort_order: z.number().int().min(0).optional(),
  split_mode: z.enum(["among_claimers", "among_group", "among_n"]).optional(),
  split_n: z.number().int().min(1).max(99).nullable().optional(),
  sub_items: z.array(z.unknown()).optional(),
});

const discountSchema = z.object({
  label: z.string().min(1).max(100),
  amount: z.number().min(0),
});

const patchSchema = z.object({
  merchant: z.string().max(200).nullable().optional(),
  receipt_date: z.string().nullable().optional(),
  receipt_time: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  currency: z.string().length(3).optional(),
  tax: z.number().min(0).optional(),
  discount: z.number().min(0).optional(),
  discounts: z.array(discountSchema).optional(),
  service_charge: z.number().min(0).optional(),
  tip: z.number().min(0).optional(),
  group_id: z.string().uuid().nullable().optional(),
  status: z
    .enum([
      "draft",
      "uploaded",
      "ocr_complete",
      "edited",
      "members_assigned",
      "finalized",
      "archived",
    ])
    .optional(),
  items: z.array(itemSchema).optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;
    const { id } = await params;

    const body = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return fromZod(parsed.error);

    const { data: existing } = await supabase
      .from("receipts")
      .select("id, group_id")
      .eq("id", id)
      .eq("created_by", user.id)
      .maybeSingle();

    if (!existing) return notFound("Receipt not found");

    const { items, discounts, ...fields } = parsed.data;

    let resolvedDiscountTotal: number | undefined;
    if (discounts !== undefined) {
      resolvedDiscountTotal = sumDiscountAmount(discounts);
    } else if (fields.discount !== undefined) {
      resolvedDiscountTotal = fields.discount;
    }

    if (discounts !== undefined) {
      const { error: discountError } = await insertReceiptDiscounts(supabase, id, discounts);
      if (discountError) return fail(discountError, 400);
    }

    if (fields.group_id !== undefined && fields.group_id !== existing.group_id) {
      if (fields.group_id) {
        const { data: group } = await supabase
          .from("groups")
          .select("id, created_by")
          .eq("id", fields.group_id)
          .maybeSingle();
        if (!group) return fail("Group not found", 404);
        if (group.created_by !== user.id) {
          return fail("Only the group creator can link receipts to this group", 403);
        }
      }
    }

    let totalsUpdate: Record<string, number> = {};

    if (items) {
      const { error: syncError, amongGroupItemIds } = await syncReceiptItems(
        supabase,
        id,
        items
      );
      if (syncError) return fail(syncError, 400);

      const receiptGroupId =
        fields.group_id !== undefined ? fields.group_id : existing.group_id;
      if (amongGroupItemIds.length && receiptGroupId) {
        const { data: members } = await supabase
          .from("group_members")
          .select("id")
          .eq("group_id", receiptGroupId);
        const memberIds = (members ?? []).map((m) => m.id);
        if (memberIds.length) {
          for (const itemId of amongGroupItemIds) {
            await supabase
              .from("receipt_item_assignments")
              .delete()
              .eq("receipt_item_id", itemId);
            await supabase.from("receipt_item_assignments").insert(
              memberIds.map((memberId) => ({
                receipt_item_id: itemId,
                member_id: memberId,
                split_method: "equal",
              }))
            );
          }
        }
      }

      let discountForTotals = resolvedDiscountTotal;
      let taxForTotals = fields.tax;
      let serviceForTotals = fields.service_charge;
      let tipForTotals = fields.tip;
      if (
        discountForTotals === undefined ||
        taxForTotals === undefined ||
        serviceForTotals === undefined ||
        tipForTotals === undefined
      ) {
        const { data: currentReceipt } = await supabase
          .from("receipts")
          .select("tax, discount, service_charge, tip")
          .eq("id", id)
          .single();
        if (discountForTotals === undefined) {
          discountForTotals = Number(currentReceipt?.discount ?? 0);
        }
        if (taxForTotals === undefined) taxForTotals = Number(currentReceipt?.tax ?? 0);
        if (serviceForTotals === undefined) {
          serviceForTotals = Number(currentReceipt?.service_charge ?? 0);
        }
        if (tipForTotals === undefined) tipForTotals = Number(currentReceipt?.tip ?? 0);
      }

      const computed = computeReceiptTotals({
        items: items.map((i) => ({
          quantity: i.quantity,
          unitPrice: i.unit_price,
          totalPrice: i.total_price,
        })),
        tax: taxForTotals,
        discount: discountForTotals,
        serviceCharge: serviceForTotals,
        tip: tipForTotals,
      });

      totalsUpdate = {
        subtotal: computed.itemsSubtotal,
        tax: computed.tax,
        discount: computed.discount,
        service_charge: computed.serviceCharge,
        tip: computed.tip,
        total: computed.total,
      };
    } else if (
      fields.tax !== undefined ||
      fields.discount !== undefined ||
      discounts !== undefined ||
      fields.service_charge !== undefined ||
      fields.tip !== undefined
    ) {
      const { data: currentItems } = await supabase
        .from("receipt_items")
        .select("quantity, unit_price, total_price")
        .eq("receipt_id", id);

      const { data: current } = await supabase
        .from("receipts")
        .select("tax, discount, service_charge, tip")
        .eq("id", id)
        .single();

      const computed = computeReceiptTotals({
        items: (currentItems ?? []).map((i) => ({
          quantity: Number(i.quantity),
          unitPrice: Number(i.unit_price),
          totalPrice: Number(i.total_price),
        })),
        tax: fields.tax ?? Number(current?.tax ?? 0),
        discount: resolvedDiscountTotal ?? Number(current?.discount ?? 0),
        serviceCharge: fields.service_charge ?? Number(current?.service_charge ?? 0),
        tip: fields.tip ?? Number(current?.tip ?? 0),
      });

      totalsUpdate = {
        subtotal: computed.itemsSubtotal,
        tax: computed.tax,
        discount: computed.discount,
        service_charge: computed.serviceCharge,
        tip: computed.tip,
        total: computed.total,
      };
    }

    const status =
      fields.status ??
      (items ? "edited" : undefined);

    const { data: receipt, error } = await supabase
      .from("receipts")
      .update({
        ...fields,
        ...totalsUpdate,
        ...(status ? { status } : {}),
        ...(status === "finalized" ? { finalized_at: new Date().toISOString() } : {}),
      })
      .eq("id", id)
      .eq("created_by", user.id)
      .select("*")
      .single();

    if (error) return fail(error.message, 400);

    await supabase.from("receipt_history").insert({
      receipt_id: id,
      user_id: user.id,
      event: status === "finalized" ? "finalized" : "edited",
      metadata: { fields: Object.keys(parsed.data) },
    });

    const { data: savedItems } = await supabase
      .from("receipt_items")
      .select("*")
      .eq("receipt_id", id)
      .order("sort_order", { ascending: true });

    const { data: savedDiscounts, error: savedDiscountsError } = await supabase
      .from("receipt_discounts")
      .select("*")
      .eq("receipt_id", id)
      .order("sort_order", { ascending: true });

    const normalizedDiscounts = normalizeDiscountRows(
      isReceiptDiscountsUnavailable(savedDiscountsError)
        ? []
        : (savedDiscounts ?? []).map((row) => ({
            id: row.id,
            label: row.label,
            amount: Number(row.amount),
            sort_order: row.sort_order,
          })),
      Number(receipt.discount)
    );

    const groupId =
      (receipt.group_id as string | null) ?? (existing.group_id as string | null);
    const affectsMovedPalTotals =
      items !== undefined ||
      fields.tax !== undefined ||
      fields.discount !== undefined ||
      discounts !== undefined ||
      fields.service_charge !== undefined ||
      fields.tip !== undefined;

    if (groupId && affectsMovedPalTotals) {
      try {
        await syncMovedToPalDebtsForGroup(supabase, groupId, {
          actorUserId: user.id,
        });
      } catch (e) {
        console.error("syncMovedToPalDebtsForGroup after receipt patch", e);
      }
    }

    return ok({ receipt, items: savedItems ?? [], discounts: normalizedDiscounts });
  } catch (error) {
    console.error(error);
    return serverError();
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;
    const { id } = await params;

    const { data: images } = await supabase
      .from("receipt_images")
      .select("storage_path")
      .eq("receipt_id", id);

    const { data: deleted, error } = await supabase
      .from("receipts")
      .delete()
      .eq("id", id)
      .eq("created_by", user.id)
      .select("id")
      .maybeSingle();

    if (error) return fail(error.message, 400);
    if (!deleted) return notFound("Receipt not found");

    const paths = (images ?? []).map((i) => i.storage_path).filter(Boolean);
    if (paths.length) {
      await supabase.storage.from("receipts").remove(paths);
      await supabase.storage
        .from("ocr-json")
        .remove([`${user.id}/${id}/ocr.json`]);
    }

    return ok({ deleted: true });
  } catch (error) {
    console.error(error);
    return serverError();
  }
}
