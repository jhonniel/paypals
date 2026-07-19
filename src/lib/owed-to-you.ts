import {
  computeOwesToPayer,
  computeSplitBalances,
  type AssignmentInput,
  type ItemSplitInput,
} from "@/lib/splits";
import { moneyNumber } from "@/lib/money";
import type { SupabaseClient } from "@supabase/supabase-js";

export type OwedToYouRow = {
  memberId: string;
  userId: string | null;
  name: string;
  amount: number;
  currency: string;
  receiptCount: number;
  receiptIds: string[];
};

/**
 * Aggregate who still owes the current user on bills they paid.
 */
export async function computeOwedToYou(
  supabase: SupabaseClient,
  userId: string
): Promise<{ rows: OwedToYouRow[]; totalOwed: number }> {
  const { data: myMemberships } = await supabase
    .from("group_members")
    .select("id, group_id")
    .eq("user_id", userId);

  const myMemberIds = (myMemberships ?? []).map((m) => m.id);
  if (myMemberIds.length === 0) {
    return { rows: [], totalOwed: 0 };
  }

  const { data: receipts } = await supabase
    .from("receipts")
    .select(
      "id, currency, tax, discount, service_charge, tip, paid_by_member_id, group_id"
    )
    .in("paid_by_member_id", myMemberIds)
    .not("group_id", "is", null)
    .limit(80);

  if (!receipts?.length) {
    return { rows: [], totalOwed: 0 };
  }

  const receiptIds = receipts.map((r) => r.id);
  const groupIds = [
    ...new Set(receipts.map((r) => r.group_id).filter(Boolean) as string[]),
  ];

  const [{ data: items }, { data: members }] = await Promise.all([
    supabase
      .from("receipt_items")
      .select("id, receipt_id, name, quantity, total_price")
      .in("receipt_id", receiptIds),
    supabase
      .from("group_members")
      .select(
        "id, group_id, user_id, guest_name, profiles:user_id(full_name, username, email)"
      )
      .in("group_id", groupIds),
  ]);

  const itemIds = (items ?? []).map((i) => i.id);
  const { data: assignments } = itemIds.length
    ? await supabase
        .from("receipt_item_assignments")
        .select(
          "receipt_item_id, member_id, split_method, share_percentage, share_quantity, share_amount"
        )
        .in("receipt_item_id", itemIds)
    : { data: [] };

  const memberLabel = (m: {
    guest_name: string | null;
    profiles:
      | { full_name: string | null; username: string | null; email: string | null }
      | { full_name: string | null; username: string | null; email: string | null }[]
      | null;
  }) => {
    const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    return p?.full_name || p?.username || m.guest_name || p?.email || "Member";
  };

  const memberById = new Map((members ?? []).map((m) => [m.id, m]));
  const memberIdsByGroup = new Map<string, string[]>();
  for (const m of members ?? []) {
    const list = memberIdsByGroup.get(m.group_id) ?? [];
    list.push(m.id);
    memberIdsByGroup.set(m.group_id, list);
  }
  const itemsByReceipt = new Map<string, typeof items>();
  for (const item of items ?? []) {
    const list = itemsByReceipt.get(item.receipt_id) ?? [];
    list.push(item);
    itemsByReceipt.set(item.receipt_id, list);
  }

  type Acc = {
    memberId: string;
    userId: string | null;
    name: string;
    amount: number;
    currency: string;
    receiptIds: Set<string>;
  };
  const owed = new Map<string, Acc>();

  for (const receipt of receipts) {
    const paidBy = receipt.paid_by_member_id;
    if (!paidBy || !myMemberIds.includes(paidBy)) continue;

    const rItems = itemsByReceipt.get(receipt.id) ?? [];
    const splitItems: ItemSplitInput[] = rItems.map((item) => {
      const asg = (assignments ?? []).filter((a) => a.receipt_item_id === item.id);
      const assignmentInputs: AssignmentInput[] = asg.map((a) => ({
        memberId: a.member_id,
        splitMethod: a.split_method,
        sharePercentage:
          a.share_percentage != null ? Number(a.share_percentage) : null,
        shareQuantity: a.share_quantity != null ? Number(a.share_quantity) : null,
        shareAmount: a.share_amount != null ? Number(a.share_amount) : null,
      }));
      return {
        itemId: item.id,
        itemName: item.name,
        itemTotal: Number(item.total_price),
        itemQuantity: Number(item.quantity),
        assignments: assignmentInputs,
      };
    });

    const summary = computeSplitBalances(
      splitItems,
      {
        tax: Number(receipt.tax),
        discount: Number(receipt.discount),
        serviceCharge: Number(receipt.service_charge),
        tip: Number(receipt.tip),
      },
      {
        equalServiceChargeMemberIds: receipt.group_id
          ? memberIdsByGroup.get(receipt.group_id) ?? []
          : [],
      }
    );

    const owes = computeOwesToPayer(summary, paidBy);
    const currency = receipt.currency ?? "PHP";

    for (const o of owes) {
      if (o.amount <= 0) continue;
      const from = memberById.get(o.fromMemberId);
      // Skip if the debtor is also me (shouldn't happen)
      if (from?.user_id === userId) continue;

      const key = from?.user_id ?? o.fromMemberId;
      const existing = owed.get(key);
      if (existing) {
        existing.amount = moneyNumber(existing.amount + o.amount);
        existing.receiptIds.add(receipt.id);
      } else {
        owed.set(key, {
          memberId: o.fromMemberId,
          userId: from?.user_id ?? null,
          name: from ? memberLabel(from) : "Member",
          amount: moneyNumber(o.amount),
          currency,
          receiptIds: new Set([receipt.id]),
        });
      }
    }
  }

  const rows: OwedToYouRow[] = [...owed.values()]
    .map((r) => ({
      memberId: r.memberId,
      userId: r.userId,
      name: r.name,
      amount: r.amount,
      currency: r.currency,
      receiptCount: r.receiptIds.size,
      receiptIds: [...r.receiptIds],
    }))
    .sort((a, b) => b.amount - a.amount);

  const totalOwed = moneyNumber(rows.reduce((s, r) => s + r.amount, 0));
  return { rows, totalOwed };
}
