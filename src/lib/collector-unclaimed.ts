import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveReceiptPayerMemberId } from "@/lib/group-member-payments";
import { moneyNumber } from "@/lib/money";
import {
  getReceiptUnclaimedItems,
  itemClaimPoolSize,
  type ReceiptItemClaimInfo,
} from "@/lib/receipt-unclaimed";

export type UnclaimedReceiptRow = {
  receiptId: string;
  merchant: string | null;
  groupId: string;
  groupName: string;
  currency: string;
  items: Array<{
    id: string;
    name: string;
    label: string;
    value: number;
  }>;
  itemCount: number;
  totalValue: number;
};

type ReceiptRow = {
  id: string;
  merchant: string | null;
  currency: string | null;
  paid_by_member_id: string | null;
  group_id: string | null;
};

type ItemRow = {
  id: string;
  receipt_id: string;
  name: string;
  quantity: number;
  total_price: number;
  split_mode?: string | null;
  split_n?: number | null;
};

function defaultPayerMemberIdForGroup(
  groupId: string,
  members: Array<{ id: string; group_id: string; user_id: string | null; role: string }>,
  createdBy: string | null | undefined
): string | null {
  const groupMembers = members.filter((m) => m.group_id === groupId);
  const owner =
    groupMembers.find((m) => m.role === "owner") ??
    groupMembers.find((m) => m.user_id === createdBy);
  return owner?.id ?? null;
}

/** Unclaimed line items on group bills the user paid (nothing assigned yet). */
export async function computeCollectorUnclaimed(
  supabase: SupabaseClient,
  userId: string
): Promise<{
  receipts: UnclaimedReceiptRow[];
  itemCount: number;
  totalValue: number;
}> {
  const { data: myMemberships } = await supabase
    .from("group_members")
    .select("id, group_id")
    .eq("user_id", userId);

  const myMemberIds = (myMemberships ?? []).map((m) => m.id);
  const groupIds = [...new Set((myMemberships ?? []).map((m) => m.group_id as string))];
  if (!myMemberIds.length || !groupIds.length) {
    return { receipts: [], itemCount: 0, totalValue: 0 };
  }

  const receiptsQuery = await supabase
    .from("receipts")
    .select("id, merchant, currency, paid_by_member_id, group_id")
    .in("group_id", groupIds)
    .order("created_at", { ascending: false })
    .limit(200);

  let receipts: ReceiptRow[] = [];
  if (
    receiptsQuery.error &&
    /paid_by_member_id|column/i.test(receiptsQuery.error.message)
  ) {
    const fallback = await supabase
      .from("receipts")
      .select("id, merchant, currency, group_id")
      .in("group_id", groupIds)
      .order("created_at", { ascending: false })
      .limit(200);
    if (fallback.error) return { receipts: [], itemCount: 0, totalValue: 0 };
    receipts = (fallback.data ?? []).map((r) => ({
      ...r,
      paid_by_member_id: null,
    })) as ReceiptRow[];
  } else if (receiptsQuery.error) {
    return { receipts: [], itemCount: 0, totalValue: 0 };
  } else {
    receipts = (receiptsQuery.data ?? []) as ReceiptRow[];
  }
  if (!receipts.length) return { receipts: [], itemCount: 0, totalValue: 0 };

  const [{ data: groups }, { data: members }] = await Promise.all([
    supabase.from("groups").select("id, name, created_by").in("id", groupIds),
    supabase.from("group_members").select("id, group_id, user_id, role").in("group_id", groupIds),
  ]);

  const groupNameById = new Map(
    (groups ?? []).map((g) => [g.id as string, g.name as string])
  );
  const createdByByGroup = new Map(
    (groups ?? []).map((g) => [g.id as string, g.created_by as string])
  );
  const defaultPayerByGroup = new Map<string, string | null>();
  for (const groupId of groupIds) {
    defaultPayerByGroup.set(
      groupId,
      defaultPayerMemberIdForGroup(
        groupId,
        (members ?? []) as Array<{
          id: string;
          group_id: string;
          user_id: string | null;
          role: string;
        }>,
        createdByByGroup.get(groupId)
      )
    );
  }

  const myReceipts = receipts.filter((receipt) => {
    if (!receipt.group_id) return false;
    const paidBy = resolveReceiptPayerMemberId(
      receipt.paid_by_member_id,
      defaultPayerByGroup.get(receipt.group_id)
    );
    return paidBy != null && myMemberIds.includes(paidBy);
  });

  if (!myReceipts.length) return { receipts: [], itemCount: 0, totalValue: 0 };

  const receiptIds = myReceipts.map((r) => r.id);

  const itemsQuery = await supabase
    .from("receipt_items")
    .select("id, receipt_id, name, quantity, total_price, split_mode, split_n")
    .in("receipt_id", receiptIds);

  let items: ItemRow[] = [];
  if (itemsQuery.error && /split_mode|split_n|column/i.test(itemsQuery.error.message)) {
    const fallback = await supabase
      .from("receipt_items")
      .select("id, receipt_id, name, quantity, total_price")
      .in("receipt_id", receiptIds);
    if (fallback.error) return { receipts: [], itemCount: 0, totalValue: 0 };
    items = (fallback.data ?? []) as ItemRow[];
  } else if (itemsQuery.error) {
    return { receipts: [], itemCount: 0, totalValue: 0 };
  } else {
    items = (itemsQuery.data ?? []) as ItemRow[];
  }
  const itemIds = items.map((i) => i.id);

  const { data: assignments } = itemIds.length
    ? await supabase
        .from("receipt_item_assignments")
        .select("receipt_item_id, member_id, share_quantity")
        .in("receipt_item_id", itemIds)
    : { data: [] };

  const claimedQtyByItem = new Map<string, number>();
  for (const a of assignments ?? []) {
    const qty = Number(a.share_quantity ?? 0) || 1;
    claimedQtyByItem.set(
      a.receipt_item_id,
      (claimedQtyByItem.get(a.receipt_item_id) ?? 0) + qty
    );
  }

  const itemsByReceipt = new Map<string, ItemRow[]>();
  for (const item of items) {
    const list = itemsByReceipt.get(item.receipt_id) ?? [];
    list.push(item);
    itemsByReceipt.set(item.receipt_id, list);
  }

  const rows: UnclaimedReceiptRow[] = [];
  let itemCount = 0;
  let totalValue = 0;

  for (const receipt of myReceipts) {
    const rItems = itemsByReceipt.get(receipt.id) ?? [];
    const claimItems: ReceiptItemClaimInfo[] = rItems.map((item) => {
      const claimed = claimedQtyByItem.get(item.id) ?? 0;
      const draft: ReceiptItemClaimInfo = {
        id: item.id,
        name: item.name,
        quantity: Math.max(1, Number(item.quantity) || 1),
        total_price: Number(item.total_price),
        split_mode: item.split_mode,
        split_n: item.split_n,
        claimed_quantity: claimed,
      };
      const poolSize = itemClaimPoolSize(draft);
      return {
        ...draft,
        remaining_quantity: Math.max(0, poolSize - claimed),
      };
    });

    const summary = getReceiptUnclaimedItems(claimItems);
    if (summary.count === 0) continue;

    const groupId = receipt.group_id!;
    rows.push({
      receiptId: receipt.id,
      merchant: receipt.merchant,
      groupId,
      groupName: groupNameById.get(groupId) ?? "Group",
      currency: receipt.currency ?? "PHP",
      items: summary.items.map((i) => ({
        id: i.id,
        name: i.name,
        label: i.label,
        value: i.value,
      })),
      itemCount: summary.count,
      totalValue: moneyNumber(summary.totalValue),
    });
    itemCount += summary.count;
    totalValue = moneyNumber(totalValue + summary.totalValue);
  }

  rows.sort((a, b) => b.totalValue - a.totalValue);
  return { receipts: rows, itemCount, totalValue: moneyNumber(totalValue) };
}
