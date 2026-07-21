import type { SupabaseClient } from "@supabase/supabase-js";
import { moneyNumber } from "@/lib/money";
import {
  normalizeSubItems,
  type ReceiptSubItem,
} from "@/lib/receipt-sub-items";
import {
  computeSplitBalances,
  type AssignmentInput,
  type ItemSplitInput,
  type ItemSplitMode,
} from "@/lib/splits";

export type MemberPaymentItem = {
  name: string;
  quantity: number;
  amount: number;
  sub_items?: ReceiptSubItem[];
};

export type MemberPaymentReceipt = {
  receipt_id: string;
  merchant: string | null;
  receipt_date: string | null;
  currency: string;
  amount: number;
  items: MemberPaymentItem[];
};

export type MemberPaymentSummary = {
  member_id: string;
  total: number;
  currency: string;
  receipts: MemberPaymentReceipt[];
};

export function isMemberMarkedPaid(
  payTotal: number,
  proof?: {
    status: string;
    expected_amount: number;
    manual: boolean;
  } | null
): boolean {
  if (!proof || payTotal <= 0) return false;
  return (
    proof.status === "paid" &&
    (Boolean(proof.manual) ||
      Math.abs(proof.expected_amount - payTotal) <= 1)
  );
}

type AssignmentRow = {
  member_id: string;
  split_method: AssignmentInput["splitMethod"];
  share_percentage: number | null;
  share_quantity: number | null;
  share_amount: number | null;
};

async function loadGroupReceiptsWithAssignments(
  supabase: SupabaseClient,
  groupId: string
) {
  let receiptsQuery = await supabase
    .from("receipts")
    .select(
      `id, merchant, currency, receipt_date, tax, discount, service_charge, tip,
       receipt_items(id, name, quantity, total_price, sort_order, split_mode, split_n, sub_items)`
    )
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (
    receiptsQuery.error &&
    /sub_items|column/i.test(receiptsQuery.error.message)
  ) {
    receiptsQuery = (await supabase
      .from("receipts")
      .select(
        `id, merchant, currency, receipt_date, tax, discount, service_charge, tip,
         receipt_items(id, name, quantity, total_price, sort_order, split_mode, split_n)`
      )
      .eq("group_id", groupId)
      .order("created_at", { ascending: false })
      .limit(50)) as typeof receiptsQuery;
  }

  if (
    receiptsQuery.error &&
    /split_mode|split_n|column/i.test(receiptsQuery.error.message)
  ) {
    receiptsQuery = (await supabase
      .from("receipts")
      .select(
        `id, merchant, currency, receipt_date, tax, discount, service_charge, tip,
         receipt_items(id, name, quantity, total_price, sort_order)`
      )
      .eq("group_id", groupId)
      .order("created_at", { ascending: false })
      .limit(50)) as typeof receiptsQuery;
  }

  const receipts = receiptsQuery.data ?? [];
  const itemIds = receipts.flatMap((r) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((r as any).receipt_items ?? []).map((i: { id: string }) => i.id)
  );

  const assignmentsByItem = new Map<string, AssignmentRow[]>();
  if (itemIds.length) {
    const { data: assignments } = await supabase
      .from("receipt_item_assignments")
      .select(
        "receipt_item_id, member_id, split_method, share_percentage, share_quantity, share_amount"
      )
      .in("receipt_item_id", itemIds);
    for (const a of assignments ?? []) {
      const list = assignmentsByItem.get(a.receipt_item_id) ?? [];
      list.push({
        member_id: a.member_id,
        split_method: a.split_method,
        share_percentage: a.share_percentage,
        share_quantity: a.share_quantity,
        share_amount: a.share_amount,
      });
      assignmentsByItem.set(a.receipt_item_id, list);
    }
  }

  return { receipts, assignmentsByItem };
}

/** Per-member pay totals with receipt / item breakdown for a group. */
export async function getGroupMemberPayments(
  supabase: SupabaseClient,
  groupId: string,
  memberIds: string[]
): Promise<MemberPaymentSummary[]> {
  const acc = new Map<
    string,
    {
      total: number;
      currency: string;
      receipts: MemberPaymentReceipt[];
    }
  >();
  for (const mid of memberIds) {
    acc.set(mid, { total: 0, currency: "PHP", receipts: [] });
  }
  if (!memberIds.length) return [];

  const { receipts, assignmentsByItem } = await loadGroupReceiptsWithAssignments(
    supabase,
    groupId
  );

  for (const r of receipts) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = ((r as any).receipt_items ?? []) as Array<{
      id: string;
      name: string;
      quantity: number;
      total_price: number;
      split_mode: string | null;
      split_n: number | null;
      sub_items?: unknown;
    }>;

    const subItemsById = new Map<string, ReceiptSubItem[]>();
    for (const item of items) {
      subItemsById.set(item.id, normalizeSubItems(item.sub_items));
    }

    const splitItems: ItemSplitInput[] = items.map((item) => {
      const asg = assignmentsByItem.get(item.id) ?? [];
      const assignmentInputs: AssignmentInput[] = asg.map((a) => ({
        memberId: a.member_id,
        splitMethod: a.split_method,
        sharePercentage: a.share_percentage,
        shareQuantity: a.share_quantity,
        shareAmount: a.share_amount,
      }));
      return {
        itemId: item.id,
        itemName: item.name,
        itemTotal: Number(item.total_price),
        itemQuantity: Number(item.quantity),
        splitMode: (item.split_mode as ItemSplitMode) ?? "among_n",
        splitN: item.split_n ?? null,
        assignments: assignmentInputs,
      };
    });

    const summary = computeSplitBalances(
      splitItems,
      {
        tax: Number(r.tax),
        discount: Number(r.discount),
        serviceCharge: Number(r.service_charge),
        tip: Number(r.tip),
      },
      {
        equalServiceChargeMemberIds: memberIds,
        groupMemberIds: memberIds,
      }
    );

    const currency = (r.currency as string) || "PHP";
    for (const share of summary.members) {
      const row = acc.get(share.memberId);
      if (!row || share.total <= 0) continue;

      row.currency = currency;
      row.total = moneyNumber(row.total + share.total);

      const receiptItems: MemberPaymentItem[] = [];
      for (const line of share.lines) {
        const asg = (assignmentsByItem.get(line.itemId) ?? []).find(
          (a) => a.member_id === share.memberId
        );
        const qty =
          asg?.share_quantity != null && asg.share_quantity > 0
            ? Number(asg.share_quantity)
            : 1;
        const subs = subItemsById.get(line.itemId) ?? [];
        receiptItems.push({
          name: line.itemName,
          quantity: qty,
          amount: moneyNumber(line.amount),
          ...(subs.length ? { sub_items: subs } : {}),
        });
      }

      row.receipts.push({
        receipt_id: r.id,
        merchant: (r.merchant as string | null) ?? null,
        receipt_date: (r.receipt_date as string | null) ?? null,
        currency,
        amount: moneyNumber(share.total),
        items: receiptItems,
      });
    }
  }

  return memberIds.map((mid) => {
    const row = acc.get(mid)!;
    return {
      member_id: mid,
      total: moneyNumber(row.total),
      currency: row.currency,
      receipts: row.receipts,
    };
  });
}

/** Compute what a group member currently owes across all group receipts. */
export async function getMemberGroupPayTotal(
  supabase: SupabaseClient,
  groupId: string,
  memberId: string
): Promise<{ total: number; currency: string } | null> {
  const { data: members } = await supabase
    .from("group_members")
    .select("id")
    .eq("group_id", groupId);
  const memberIds = (members ?? []).map((m) => m.id);
  if (!memberIds.includes(memberId)) return null;

  const { data: receipts } = await supabase
    .from("receipts")
    .select(
      `id, currency, tax, discount, service_charge, tip,
       receipt_items(id, name, quantity, total_price, sort_order, split_mode, split_n)`
    )
    .eq("group_id", groupId)
    .limit(50);

  if (!receipts?.length) return { total: 0, currency: "PHP" };

  const itemIds = receipts.flatMap((r) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((r as any).receipt_items ?? []).map((i: { id: string }) => i.id)
  );

  const assignmentsByItem = new Map<
    string,
    Array<{
      member_id: string;
      split_method: AssignmentInput["splitMethod"];
      share_percentage: number | null;
      share_quantity: number | null;
      share_amount: number | null;
    }>
  >();

  if (itemIds.length) {
    const { data: assignments } = await supabase
      .from("receipt_item_assignments")
      .select(
        "receipt_item_id, member_id, split_method, share_percentage, share_quantity, share_amount"
      )
      .in("receipt_item_id", itemIds);
    for (const a of assignments ?? []) {
      const list = assignmentsByItem.get(a.receipt_item_id) ?? [];
      list.push({
        member_id: a.member_id,
        split_method: a.split_method,
        share_percentage: a.share_percentage,
        share_quantity: a.share_quantity,
        share_amount: a.share_amount,
      });
      assignmentsByItem.set(a.receipt_item_id, list);
    }
  }

  let total = 0;
  let currency = "PHP";

  for (const r of receipts) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = ((r as any).receipt_items ?? []) as Array<{
      id: string;
      name: string;
      quantity: number;
      total_price: number;
      split_mode: string | null;
      split_n: number | null;
    }>;

    const splitItems: ItemSplitInput[] = items.map((item) => {
      const asg = assignmentsByItem.get(item.id) ?? [];
      const assignmentInputs: AssignmentInput[] = asg.map((a) => ({
        memberId: a.member_id,
        splitMethod: a.split_method,
        sharePercentage: a.share_percentage,
        shareQuantity: a.share_quantity,
        shareAmount: a.share_amount,
      }));
      return {
        itemId: item.id,
        itemName: item.name,
        itemTotal: Number(item.total_price),
        itemQuantity: Number(item.quantity),
        splitMode: (item.split_mode as ItemSplitMode) ?? "among_n",
        splitN: item.split_n ?? null,
        assignments: assignmentInputs,
      };
    });

    const summary = computeSplitBalances(
      splitItems,
      {
        tax: Number(r.tax),
        discount: Number(r.discount),
        serviceCharge: Number(r.service_charge),
        tip: Number(r.tip),
      },
      {
        equalServiceChargeMemberIds: memberIds,
        groupMemberIds: memberIds,
      }
    );

    currency = (r.currency as string) || currency;
    const share = summary.members.find((m) => m.memberId === memberId);
    if (share) total = moneyNumber(total + share.total);
  }

  return { total, currency };
}
