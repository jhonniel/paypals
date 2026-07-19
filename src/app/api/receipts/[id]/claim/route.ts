import { z } from "zod";
import { getAuthedClient } from "@/lib/supabase/auth";
import { ok, unauthorized, notFound, fail, fromZod, serverError } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  /** Item IDs this member is claiming (empty = nothing for me). */
  item_ids: z.array(z.string().uuid()),
});

/**
 * Member confirms what they got on a group receipt.
 * Saves their claims (without wiping others) and marks the receipt reviewed
 * so they can enter the group page.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;
    const { id } = await params;

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    const { data: receipt } = await supabase
      .from("receipts")
      .select("id, group_id, created_by")
      .eq("id", id)
      .maybeSingle();

    if (!receipt) return notFound("Receipt not found");
    if (!receipt.group_id) {
      return fail("This receipt is not linked to a group", 400);
    }

    const { data: membership } = await supabase
      .from("group_members")
      .select("id")
      .eq("group_id", receipt.group_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) return fail("Join the group first", 403);

    const myMemberId = membership.id;

    const { data: items } = await supabase
      .from("receipt_items")
      .select("id, quantity, total_price")
      .eq("receipt_id", id);

    const itemIds = (items ?? []).map((i) => i.id);
    const itemSet = new Set(itemIds);
    const claimedIds = parsed.data.item_ids.filter((iid) => itemSet.has(iid));

    if (!itemIds.length) {
      await supabase.from("receipt_history").insert({
        receipt_id: id,
        user_id: user.id,
        event: "claims_confirmed",
        metadata: { member_id: myMemberId, item_ids: [] },
      });
      return ok({ confirmed: true, claimed: 0 });
    }

    const { data: existing } = await supabase
      .from("receipt_item_assignments")
      .select(
        "receipt_item_id, member_id, split_method, share_percentage, share_quantity, share_amount"
      )
      .in("receipt_item_id", itemIds);

    const others = (existing ?? []).filter((a) => a.member_id !== myMemberId);

    const mine = claimedIds.map((receiptItemId) => {
      const item = items!.find((i) => i.id === receiptItemId)!;
      const shareCount = Math.max(
        1,
        others.filter((a) => a.receipt_item_id === receiptItemId).length + 1
      );
      return {
        receipt_item_id: receiptItemId,
        member_id: myMemberId,
        split_method: "equal" as const,
        share_percentage: null,
        share_quantity: Number(item.quantity) / shareCount,
        share_amount: null,
      };
    });

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

    const { error: histErr } = await supabase.from("receipt_history").insert({
      receipt_id: id,
      user_id: user.id,
      event: "claims_confirmed",
      metadata: { member_id: myMemberId, item_ids: claimedIds },
    });
    if (histErr) return fail(histErr.message, 400);

    return ok({ confirmed: true, claimed: claimedIds.length });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
