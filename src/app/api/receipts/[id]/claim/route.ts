import { z } from "zod";
import { getAuthedClient } from "@/lib/supabase/auth";
import { ok, unauthorized, notFound, fail, fromZod, serverError } from "@/lib/api";
import { itemClaimSlots } from "@/lib/splits";

type Params = { params: Promise<{ id: string }> };

const claimSchema = z.object({
  item_id: z.string().uuid(),
  /** How many units of this line the member got */
  quantity: z.number().positive().max(999),
});

const schema = z.object({
  /** Empty = nothing for me. Prefer `claims`; `item_ids` kept for older clients. */
  claims: z.array(claimSchema).optional(),
  item_ids: z.array(z.string().uuid()).optional(),
  /** Owner/admin may assign picks for another group member. */
  for_member_id: z.string().uuid().optional(),
});

/**
 * Member confirms what they got (item + quantity) on a group receipt.
 * Owners/admins can pass `for_member_id` to preselect for someone else.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;
    const { id } = await params;

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    const claims =
      parsed.data.claims ??
      (parsed.data.item_ids ?? []).map((item_id) => ({ item_id, quantity: 1 }));

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
      .select("id, role")
      .eq("group_id", receipt.group_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) return fail("Join the group first", 403);

    let targetMemberId = membership.id;
    let historyUserId = user.id;
    let assignedBy: string | null = null;

    if (
      parsed.data.for_member_id &&
      parsed.data.for_member_id !== membership.id
    ) {
      const canAssign =
        membership.role === "owner" ||
        membership.role === "admin" ||
        receipt.created_by === user.id;
      if (!canAssign) {
        return fail("Only the group owner or admin can pick items for others", 403);
      }

      const { data: target } = await supabase
        .from("group_members")
        .select("id, user_id, group_id")
        .eq("id", parsed.data.for_member_id)
        .eq("group_id", receipt.group_id)
        .maybeSingle();

      if (!target) return fail("Member not found in this group", 404);

      targetMemberId = target.id;
      assignedBy = membership.id;
      // Clear the join gate for seated members when an owner preselects for them
      if (target.user_id) historyUserId = target.user_id;
    }

    let items: Array<{
      id: string;
      quantity: number;
      total_price: number;
      split_mode?: string | null;
      split_n?: number | null;
    }> = [];

    const { data: withSplit, error: itemsErr } = await supabase
      .from("receipt_items")
      .select("id, quantity, total_price, split_mode, split_n")
      .eq("receipt_id", id);

    if (itemsErr && /split_mode|split_n|column/i.test(itemsErr.message)) {
      const { data: fallbackItems } = await supabase
        .from("receipt_items")
        .select("id, quantity, total_price")
        .eq("receipt_id", id);
      items = (fallbackItems ?? []).map((i) => ({
        ...i,
        split_mode: "among_n",
        split_n: 1,
      }));
    } else if (itemsErr) {
      return fail(itemsErr.message, 400);
    } else {
      items = withSplit ?? [];
    }

    return await finalizeClaim(
      supabase,
      historyUserId,
      id,
      targetMemberId,
      items,
      claims,
      assignedBy
        ? { assigned_by_member_id: assignedBy, assigned_by_user_id: user.id }
        : null
    );
  } catch (e) {
    console.error(e);
    return serverError();
  }
}

function othersClaimedQty(
  others: Array<{
    receipt_item_id: string;
    share_quantity: number | null;
  }>,
  itemId: string,
  itemQty: number
): number {
  const rows = others.filter((a) => a.receipt_item_id === itemId);
  if (!rows.length) return 0;
  const sum = rows.reduce((s, a) => s + Number(a.share_quantity ?? 0), 0);
  if (sum > 0) return sum;
  // Legacy equal claims without qty — assume 1 unit each (capped)
  return Math.min(itemQty, rows.length);
}

async function finalizeClaim(
  supabase: Awaited<NonNullable<Awaited<ReturnType<typeof getAuthedClient>>>>["supabase"],
  userId: string,
  receiptId: string,
  myMemberId: string,
  items: Array<{
    id: string;
    quantity: number;
    total_price: number;
    split_mode?: string | null;
    split_n?: number | null;
  }>,
  claims: Array<{ item_id: string; quantity: number }>,
  assignMeta: {
    assigned_by_member_id: string;
    assigned_by_user_id: string;
  } | null = null
) {
  const itemIds = items.map((i) => i.id);
  const itemById = new Map(items.map((i) => [i.id, i]));

  if (!itemIds.length) {
    await supabase.from("receipt_history").insert({
      receipt_id: receiptId,
      user_id: userId,
      event: "claims_confirmed",
      metadata: {
        member_id: myMemberId,
        claims: [],
        ...(assignMeta ?? {}),
      },
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

  const mine: Array<{
    receipt_item_id: string;
    member_id: string;
    split_method: "quantity";
    share_percentage: null;
    share_quantity: number;
    share_amount: null;
  }> = [];

  for (const claim of claims) {
    const item = itemById.get(claim.item_id);
    if (!item) continue;
    if (item.split_mode === "among_group") continue;

    const mode =
      (item.split_mode as "among_n" | "among_claimers" | "among_group") ?? "among_n";
    const splitN = Math.max(1, Math.floor(Number(item.split_n) || 1));
    const itemQty = Math.max(0.001, Number(item.quantity) || 1);
    const multiWay = mode === "among_n" && splitN > 1;
    // Multi-way: pool is N shares. Otherwise: receipt line units.
    const poolSize = multiWay ? splitN : itemQty;
    const takenByOthers = othersClaimedQty(others, item.id, poolSize);
    const remaining = Math.max(0, poolSize - takenByOthers);

    const slots = itemClaimSlots(mode, item.split_n ?? 1);
    const othersCount = others.filter((a) => a.receipt_item_id === item.id).length;
    if (slots != null && !multiWay && othersCount >= slots && remaining <= 0) {
      return fail(`${item.id.slice(0, 8)}… was already taken`, 409);
    }
    if (multiWay && remaining <= 0) {
      return fail("No shares left on that item", 409);
    }

    const want = Math.min(
      Number(claim.quantity) || 1,
      remaining > 0 ? remaining : poolSize
    );
    if (want <= 0) {
      return fail(
        multiWay ? "No shares left on that item" : "Not enough quantity left on that item",
        409
      );
    }
    if (remaining > 0 && want > remaining + 1e-9) {
      return fail(
        multiWay
          ? `Only ${remaining} share${remaining === 1 ? "" : "s"} left`
          : `Only ${remaining} left on that item`,
        409
      );
    }

    mine.push({
      receipt_item_id: item.id,
      member_id: myMemberId,
      split_method: "quantity",
      share_percentage: null,
      share_quantity: want,
      share_amount: null,
    });
  }

  const groupItemIds = new Set(
    items.filter((i) => i.split_mode === "among_group").map((i) => i.id)
  );
  const claimableItemIds = itemIds.filter((iid) => !groupItemIds.has(iid));

  if (claimableItemIds.length) {
    await supabase
      .from("receipt_item_assignments")
      .delete()
      .in("receipt_item_id", claimableItemIds);

    const othersClaimable = others.filter((a) =>
      claimableItemIds.includes(a.receipt_item_id)
    );

    const merged = [
      ...othersClaimable.map((a) => ({
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
  }

  await supabase
    .from("receipts")
    .update({ status: "members_assigned" })
    .eq("id", receiptId);

  const { error: histErr } = await supabase.from("receipt_history").insert({
    receipt_id: receiptId,
    user_id: userId,
    event: "claims_confirmed",
    metadata: {
      member_id: myMemberId,
      claims,
      ...(assignMeta ?? {}),
    },
  });
  if (histErr) return fail(histErr.message, 400);

  return ok({ confirmed: true, claimed: mine.length });
}
