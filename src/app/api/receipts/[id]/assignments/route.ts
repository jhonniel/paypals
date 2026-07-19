import { z } from "zod";
import { getAuthedClient } from "@/lib/supabase/auth";
import { ok, unauthorized, fail, fromZod, serverError, notFound } from "@/lib/api";
import { computeSplitBalances, type AssignmentInput, type ItemSplitInput } from "@/lib/splits";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;
    const { id } = await params;

    const { data: receipt, error } = await supabase
      .from("receipts")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) return fail(error.message, 400);
    if (!receipt) return notFound("Receipt not found");

    // Access: creator or group member (RLS also enforces)
    if (receipt.created_by !== user.id && !receipt.group_id) {
      // still allow if RLS permits — fetch will be empty otherwise
    }

    const { data: items } = await supabase
      .from("receipt_items")
      .select("*")
      .eq("receipt_id", id)
      .order("sort_order");

    const itemIds = (items ?? []).map((i) => i.id);
    const { data: assignments } = itemIds.length
      ? await supabase
          .from("receipt_item_assignments")
          .select("*")
          .in("receipt_item_id", itemIds)
      : { data: [] };

    let members: Array<Record<string, unknown>> = [];
    if (receipt.group_id) {
      const withPay = await supabase
        .from("group_members")
        .select(
          "id, role, user_id, guest_name, guest_email, profiles:user_id(full_name, username, avatar_url, payment_methods)"
        )
        .eq("group_id", receipt.group_id);
      if (withPay.error && /payment_methods|column/i.test(withPay.error.message)) {
        const fallback = await supabase
          .from("group_members")
          .select(
            "id, role, user_id, guest_name, guest_email, profiles:user_id(full_name, username, avatar_url)"
          )
          .eq("group_id", receipt.group_id);
        members = fallback.data ?? [];
      } else {
        members = withPay.data ?? [];
      }
    }

    const splitItems: ItemSplitInput[] = (items ?? []).map((item) => ({
      itemId: item.id,
      itemName: item.name,
      itemTotal: Number(item.total_price),
      itemQuantity: Number(item.quantity),
      splitMode: (item as { split_mode?: ItemSplitInput["splitMode"] }).split_mode ?? "among_claimers",
      splitN: (item as { split_n?: number | null }).split_n ?? null,
      assignments: (assignments ?? [])
        .filter((a) => a.receipt_item_id === item.id)
        .map(
          (a): AssignmentInput => ({
            memberId: a.member_id,
            splitMethod: a.split_method,
            sharePercentage: a.share_percentage != null ? Number(a.share_percentage) : null,
            shareQuantity: a.share_quantity != null ? Number(a.share_quantity) : null,
            shareAmount: a.share_amount != null ? Number(a.share_amount) : null,
          })
        ),
    }));

    const summary = computeSplitBalances(
      splitItems,
      {
        tax: Number(receipt.tax),
        discount: Number(receipt.discount),
        serviceCharge: Number(receipt.service_charge),
        tip: Number(receipt.tip),
      },
      {
        equalServiceChargeMemberIds: members.map((m) => String(m.id)),
        groupMemberIds: members.map((m) => String(m.id)),
      }
    );

    return ok({
      receipt,
      items: items ?? [],
      assignments: assignments ?? [],
      members,
      summary,
    });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}

const assignmentSchema = z.object({
  receipt_item_id: z.string().uuid(),
  member_id: z.string().uuid(),
  split_method: z.enum(["equal", "percentage", "quantity", "custom", "weighted"]),
  share_percentage: z.number().min(0).max(100).nullable().optional(),
  share_quantity: z.number().min(0).nullable().optional(),
  share_amount: z.number().min(0).nullable().optional(),
});

const putSchema = z.object({
  group_id: z.string().uuid().nullable().optional(),
  paid_by_member_id: z.string().uuid().nullable().optional(),
  settlement_note: z.string().max(500).nullable().optional(),
  assignments: z.array(assignmentSchema),
});

/** Replace all assignments for this receipt (and optionally link group / payer). */
export async function PUT(request: Request, { params }: Params) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;
    const { id } = await params;

    const parsed = putSchema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    const { data: receipt } = await supabase
      .from("receipts")
      .select("id, group_id, created_by, tax, discount, service_charge, tip")
      .eq("id", id)
      .maybeSingle();

    if (!receipt) return notFound("Receipt not found");

    const isCreator = receipt.created_by === user.id;
    let myMemberId: string | null = null;

    if (receipt.group_id) {
      const { data: membership } = await supabase
        .from("group_members")
        .select("id")
        .eq("group_id", receipt.group_id)
        .eq("user_id", user.id)
        .maybeSingle();
      myMemberId = membership?.id ?? null;
      if (!isCreator && !myMemberId) {
        return fail("You are not a member of this group", 403);
      }
    } else if (!isCreator) {
      return fail("Only the receipt owner can update assignments", 403);
    }

    // Non-creators may only claim/unclaim their own items — never change
    // group link, payer, settlement note, or other people's claims.
    if (!isCreator) {
      if (!myMemberId) return fail("Join the group first", 403);

      const { data: items } = await supabase
        .from("receipt_items")
        .select("id")
        .eq("receipt_id", id);
      const itemIds = (items ?? []).map((i) => i.id);
      if (!itemIds.length) return ok({ saved: true });

      const { data: existing } = await supabase
        .from("receipt_item_assignments")
        .select(
          "receipt_item_id, member_id, split_method, share_percentage, share_quantity, share_amount"
        )
        .in("receipt_item_id", itemIds);

      const others = (existing ?? []).filter((a) => a.member_id !== myMemberId);
      const mine = parsed.data.assignments.filter((a) => a.member_id === myMemberId);

      await supabase
        .from("receipt_item_assignments")
        .delete()
        .in("receipt_item_id", itemIds);

      const merged = [
        ...others.map((a) => ({
          receipt_item_id: a.receipt_item_id,
          member_id: a.member_id,
          split_method: a.split_method,
          share_percentage: a.share_percentage,
          share_quantity: a.share_quantity,
          share_amount: a.share_amount,
        })),
        ...mine,
      ];

      if (merged.length) {
        const { error } = await supabase
          .from("receipt_item_assignments")
          .insert(merged);
        if (error) return fail(error.message, 400);
      }

      await supabase
        .from("receipts")
        .update({ status: "members_assigned" })
        .eq("id", id);

      return ok({ saved: true, claimed: true });
    }

    const receiptPatch: Record<string, unknown> = {};
    if (parsed.data.group_id !== undefined) {
      if (parsed.data.group_id) {
        const { data: group } = await supabase
          .from("groups")
          .select("created_by")
          .eq("id", parsed.data.group_id)
          .maybeSingle();
        if (!group || group.created_by !== user.id) {
          return fail("Only the group creator can link receipts here", 403);
        }
      }
      receiptPatch.group_id = parsed.data.group_id;
    }
    if (parsed.data.paid_by_member_id !== undefined) {
      receiptPatch.paid_by_member_id = parsed.data.paid_by_member_id;
    }
    if (parsed.data.settlement_note !== undefined) {
      receiptPatch.settlement_note = parsed.data.settlement_note?.trim() || null;
    }
    if (Object.keys(receiptPatch).length) {
      const { error: gErr } = await supabase
        .from("receipts")
        .update(receiptPatch)
        .eq("id", id)
        .eq("created_by", user.id);
      if (gErr) return fail(gErr.message, 400);
    }

    const { data: items } = await supabase
      .from("receipt_items")
      .select("id")
      .eq("receipt_id", id);

    const itemIds = (items ?? []).map((i) => i.id);
    if (itemIds.length) {
      await supabase
        .from("receipt_item_assignments")
        .delete()
        .in("receipt_item_id", itemIds);
    }

    if (parsed.data.assignments.length) {
      const { error } = await supabase
        .from("receipt_item_assignments")
        .insert(parsed.data.assignments);
      if (error) return fail(error.message, 400);
    }

    await supabase
      .from("receipts")
      .update({ status: "members_assigned" })
      .eq("id", id);

    await supabase.from("receipt_history").insert({
      receipt_id: id,
      user_id: user.id,
      event: "members_assigned",
      metadata: { count: parsed.data.assignments.length },
    });

    // Notify group members
    const groupId = parsed.data.group_id ?? receipt.group_id;
    if (groupId) {
      const { data: members } = await supabase
        .from("group_members")
        .select("user_id")
        .eq("group_id", groupId)
        .not("user_id", "is", null);

      const notifications = (members ?? [])
        .filter((m) => m.user_id && m.user_id !== user.id)
        .map((m) => ({
          user_id: m.user_id as string,
          type: "split_completed" as const,
          title: "Split updated",
          body: "Item assignments changed on a shared receipt.",
          link: `/receipts/${id}`,
        }));

      if (notifications.length) {
        await supabase.from("notifications").insert(notifications);
      }
    }

    return ok({ saved: true });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
