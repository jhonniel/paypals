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
      const { data: ms } = await supabase
        .from("group_members")
        .select(
          "id, role, user_id, guest_name, guest_email, profiles:user_id(full_name, username, avatar_url)"
        )
        .eq("group_id", receipt.group_id);
      members = ms ?? [];
    }

    const splitItems: ItemSplitInput[] = (items ?? []).map((item) => ({
      itemId: item.id,
      itemName: item.name,
      itemTotal: Number(item.total_price),
      itemQuantity: Number(item.quantity),
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

    const summary = computeSplitBalances(splitItems, {
      tax: Number(receipt.tax),
      discount: Number(receipt.discount),
      serviceCharge: Number(receipt.service_charge),
      tip: Number(receipt.tip),
    });

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
  assignments: z.array(assignmentSchema),
});

/** Replace all assignments for this receipt (and optionally link group). */
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

    if (parsed.data.group_id !== undefined) {
      const { error: gErr } = await supabase
        .from("receipts")
        .update({ group_id: parsed.data.group_id })
        .eq("id", id);
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
