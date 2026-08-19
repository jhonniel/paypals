import type { SupabaseClient } from "@supabase/supabase-js";
import { moneyNumber } from "@/lib/money";
import {
  normalizeSubItems,
  scaleSubItemsForShare,
  type ReceiptSubItem,
} from "@/lib/receipt-sub-items";
import {
  computeSplitBalances,
  memberAdjustmentLines,
  memberPaymentItemDisplay,
  type AssignmentInput,
  type ItemSplitInput,
  type ItemSplitMode,
} from "@/lib/splits";

export type MemberPaymentItem = {
  name: string;
  quantity: number;
  amount: number;
  sub_items?: ReceiptSubItem[];
  group_split?: boolean;
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
  /** Total consumption share across all receipts. */
  total: number;
  /** Amount this member still needs to pay others (excludes bills they paid). */
  owes: number;
  /** Paid at least one receipt in this group. */
  is_bill_payer: boolean;
  currency: string;
  receipts: MemberPaymentReceipt[];
};

export function parsePaymentProofSource(
  raw: unknown
): { manual: boolean; bill_payer: boolean; moved_to_pal: boolean } {
  const source = (raw as { source?: string } | null)?.source;
  return {
    manual: source === "manual",
    bill_payer: source === "bill_payer",
    moved_to_pal: source === "moved_to_pal",
  };
}

export function isMemberMarkedPaid(
  owesTotal: number,
  proof?: {
    status: string;
    expected_amount: number;
    manual?: boolean;
    bill_payer?: boolean;
    moved_to_pal?: boolean;
  } | null
): boolean {
  if (!proof || proof.status !== "paid") return false;
  if (proof.bill_payer && owesTotal <= 0) return true;
  if (owesTotal <= 0) return false;
  return (
    Boolean(proof.manual) ||
    Boolean(proof.moved_to_pal) ||
    Math.abs(proof.expected_amount - owesTotal) <= 1
  );
}

/** Group owner / creator — used when a receipt has no explicit bill payer. */
export async function getGroupDefaultPayerMemberId(
  supabase: SupabaseClient,
  groupId: string
): Promise<string | null> {
  const { data: group } = await supabase
    .from("groups")
    .select("created_by")
    .eq("id", groupId)
    .maybeSingle();

  const { data: members } = await supabase
    .from("group_members")
    .select("id, user_id, role")
    .eq("group_id", groupId);

  const owner =
    members?.find((m) => m.role === "owner") ??
    members?.find((m) => m.user_id === group?.created_by);
  return owner?.id ?? null;
}

export function resolveReceiptPayerMemberId(
  paidByMemberId: string | null | undefined,
  defaultPayerMemberId: string | null | undefined
): string | null {
  return paidByMemberId ?? defaultPayerMemberId ?? null;
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
  groupId: string,
  options?: { since?: string }
) {
  const withSince = <T extends { gte: (col: string, val: string) => T }>(query: T) =>
    options?.since ? query.gte("created_at", options.since) : query;

  let receiptsQuery = await withSince(
    supabase
      .from("receipts")
      .select(
        `id, merchant, currency, receipt_date, created_at, tax, discount, service_charge, tip, paid_by_member_id,
       receipt_items(id, name, quantity, total_price, sort_order, split_mode, split_n, sub_items)`
      )
      .eq("group_id", groupId)
      .order("created_at", { ascending: false })
      .limit(50)
  );

  if (
    receiptsQuery.error &&
    /paid_by_member_id|column/i.test(receiptsQuery.error.message)
  ) {
    receiptsQuery = (await withSince(
      supabase
        .from("receipts")
        .select(
          `id, merchant, currency, receipt_date, created_at, tax, discount, service_charge, tip,
         receipt_items(id, name, quantity, total_price, sort_order, split_mode, split_n, sub_items)`
        )
        .eq("group_id", groupId)
        .order("created_at", { ascending: false })
        .limit(50)
    )) as typeof receiptsQuery;
  }

  if (
    receiptsQuery.error &&
    /sub_items|column/i.test(receiptsQuery.error.message)
  ) {
    receiptsQuery = (await withSince(
      supabase
        .from("receipts")
        .select(
          `id, merchant, currency, receipt_date, created_at, tax, discount, service_charge, tip,
         receipt_items(id, name, quantity, total_price, sort_order, split_mode, split_n)`
        )
        .eq("group_id", groupId)
        .order("created_at", { ascending: false })
        .limit(50)
    )) as typeof receiptsQuery;
  }

  if (
    receiptsQuery.error &&
    /split_mode|split_n|column/i.test(receiptsQuery.error.message)
  ) {
    receiptsQuery = (await withSince(
      supabase
        .from("receipts")
        .select(
          `id, merchant, currency, receipt_date, created_at, tax, discount, service_charge, tip,
         receipt_items(id, name, quantity, total_price, sort_order)`
        )
        .eq("group_id", groupId)
        .order("created_at", { ascending: false })
        .limit(50)
    )) as typeof receiptsQuery;
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
  memberIds: string[],
  options?: { since?: string; includeReceiptDetails?: boolean }
): Promise<MemberPaymentSummary[]> {
  const includeReceiptDetails = options?.includeReceiptDetails !== false;
  const acc = new Map<
    string,
    {
      total: number;
      owes: number;
      is_bill_payer: boolean;
      currency: string;
      receipts: MemberPaymentReceipt[];
    }
  >();
  for (const mid of memberIds) {
    acc.set(mid, { total: 0, owes: 0, is_bill_payer: false, currency: "PHP", receipts: [] });
  }
  if (!memberIds.length) return [];

  const { receipts, assignmentsByItem } = await loadGroupReceiptsWithAssignments(
    supabase,
    groupId,
    options
  );
  const defaultPayerMemberId = await getGroupDefaultPayerMemberId(
    supabase,
    groupId
  );

  for (const r of receipts) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const receipt = r as any;
    const paidBy = resolveReceiptPayerMemberId(
      receipt.paid_by_member_id as string | null | undefined,
      defaultPayerMemberId
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = (receipt.receipt_items ?? []) as Array<{
      id: string;
      name: string;
      quantity: number;
      total_price: number;
      split_mode: string | null;
      split_n: number | null;
      sub_items?: unknown;
    }>;

    const subItemsById = new Map<string, ReceiptSubItem[]>();
    const itemTotalById = new Map<string, number>();
    for (const item of items) {
      subItemsById.set(item.id, normalizeSubItems(item.sub_items));
      itemTotalById.set(item.id, Number(item.total_price) || 0);
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
      if (paidBy && paidBy === share.memberId) {
        row.is_bill_payer = true;
      } else if (share.total > 0) {
        row.owes = moneyNumber(row.owes + share.total);
      }

      const receiptItems: MemberPaymentItem[] = [];
      if (includeReceiptDetails) {
        for (const line of share.lines) {
          const asg = (assignmentsByItem.get(line.itemId) ?? []).find(
            (a) => a.member_id === share.memberId
          );
          const qty =
            asg?.share_quantity != null && asg.share_quantity > 0
              ? Number(asg.share_quantity)
              : 1;
          const itemMeta = items.find((i) => i.id === line.itemId);
          const claimerCount = (assignmentsByItem.get(line.itemId) ?? []).length;
          const { amount: itemShareAmount, group_split: groupSplit } =
            memberPaymentItemDisplay({
              lineAmount: line.amount,
              itemTotal: Number(itemMeta?.total_price ?? line.amount),
              itemQuantity: Number(itemMeta?.quantity) || 1,
              splitMode: (itemMeta?.split_mode as ItemSplitMode) ?? "among_n",
              splitN: itemMeta?.split_n ?? null,
              groupMemberCount: memberIds.length,
              claimerCount,
            });
          const itemTotal = itemTotalById.get(line.itemId) ?? 0;
          const shareRatio =
            itemTotal > 0 ? Math.min(1, itemShareAmount / itemTotal) : 1;
          const rawSubs = subItemsById.get(line.itemId) ?? [];
          const subs =
            rawSubs.length && shareRatio < 0.9999
              ? scaleSubItemsForShare(rawSubs, shareRatio)
              : rawSubs;
          receiptItems.push({
            name: line.itemName,
            quantity: groupSplit ? 1 : qty,
            amount: itemShareAmount,
            ...(groupSplit ? { group_split: true } : {}),
            ...(subs.length ? { sub_items: subs } : {}),
          });
        }

        for (const adj of memberAdjustmentLines(
          share.memberId,
          share.itemsSubtotal,
          summary.assignedTotal,
          {
            tax: Number(r.tax),
            discount: Number(r.discount),
            serviceCharge: Number(r.service_charge),
            tip: Number(r.tip),
          },
          memberIds
        )) {
          receiptItems.push({ name: adj.name, quantity: 1, amount: adj.amount });
        }
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
      owes: moneyNumber(row.owes),
      is_bill_payer: row.is_bill_payer,
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

  const payments = await getGroupMemberPayments(supabase, groupId, memberIds);
  const mine = payments.find((p) => p.member_id === memberId);
  if (!mine) return null;

  return { total: mine.owes, currency: mine.currency };
}

/** Sum the user's consumption share across every group they belong to. */
export async function computeUserGroupSpend(
  supabase: SupabaseClient,
  userId: string,
  monthStart?: string
): Promise<{
  totalShare: number;
  shareThisMonth: number;
  totalOwes: number;
  currency: string;
}> {
  const { data: memberships } = await supabase
    .from("group_members")
    .select("id, group_id")
    .eq("user_id", userId);

  if (!memberships?.length) {
    return { totalShare: 0, shareThisMonth: 0, totalOwes: 0, currency: "PHP" };
  }

  const myMemberByGroup = new Map(
    memberships.map((m) => [m.group_id as string, m.id as string])
  );
  const groupIds = [...myMemberByGroup.keys()];

  const { data: allGroupMembers } = await supabase
    .from("group_members")
    .select("id, group_id")
    .in("group_id", groupIds);

  const memberIdsByGroup = new Map<string, string[]>();
  for (const member of allGroupMembers ?? []) {
    const groupId = member.group_id as string;
    const list = memberIdsByGroup.get(groupId) ?? [];
    list.push(member.id as string);
    memberIdsByGroup.set(groupId, list);
  }

  const groupResults = await Promise.all(
    groupIds.map(async (groupId) => {
      const myMemberId = myMemberByGroup.get(groupId);
      if (!myMemberId) return null;

      const memberIds = memberIdsByGroup.get(groupId) ?? [];
      if (!memberIds.length) return null;

      const summaryOpts = { includeReceiptDetails: false as const };
      const [allPayments, monthPayments] = await Promise.all([
        getGroupMemberPayments(supabase, groupId, memberIds, summaryOpts),
        monthStart
          ? getGroupMemberPayments(supabase, groupId, memberIds, {
              ...summaryOpts,
              since: monthStart,
            })
          : Promise.resolve(null),
      ]);

      const mine = allPayments.find((p) => p.member_id === myMemberId);
      const mineMonth = monthPayments?.find((p) => p.member_id === myMemberId);

      return {
        totalShare: mine?.total ?? 0,
        shareThisMonth: mineMonth?.total ?? 0,
        totalOwes: mine?.owes ?? 0,
        currency: mine?.currency ?? mineMonth?.currency ?? "PHP",
      };
    })
  );

  let totalShare = 0;
  let shareThisMonth = 0;
  let totalOwes = 0;
  let currency = "PHP";

  for (const row of groupResults) {
    if (!row) continue;
    totalShare = moneyNumber(totalShare + row.totalShare);
    shareThisMonth = moneyNumber(shareThisMonth + row.shareThisMonth);
    totalOwes = moneyNumber(totalOwes + row.totalOwes);
    if (row.currency) currency = row.currency;
  }

  return { totalShare, shareThisMonth, totalOwes, currency };
}

export type UserGroupPayableRow = {
  groupId: string;
  groupName: string;
  owes: number;
  share: number;
  currency: string;
  isBillPayer: boolean;
  isPaid: boolean;
  receipts: MemberPaymentReceipt[];
};

/** Per-group amounts the user still needs to pay (proof-adjusted). */
export async function computeUserGroupPayableBreakdown(
  supabase: SupabaseClient,
  userId: string
): Promise<{
  totalOwes: number;
  currency: string;
  groups: UserGroupPayableRow[];
}> {
  const { data: memberships } = await supabase
    .from("group_members")
    .select("id, group_id, groups(id, name)")
    .eq("user_id", userId);

  if (!memberships?.length) {
    return { totalOwes: 0, currency: "PHP", groups: [] };
  }

  const groupIds = memberships.map((m) => m.group_id as string);

  const [{ data: allGroupMembers }, { data: allProofs }] = await Promise.all([
    supabase.from("group_members").select("id, group_id").in("group_id", groupIds),
    supabase
      .from("group_payment_proofs")
      .select("group_id, from_member_id, status, expected_amount, ocr_raw")
      .in("group_id", groupIds),
  ]);

  const memberIdsByGroup = new Map<string, string[]>();
  for (const member of allGroupMembers ?? []) {
    const groupId = member.group_id as string;
    const list = memberIdsByGroup.get(groupId) ?? [];
    list.push(member.id as string);
    memberIdsByGroup.set(groupId, list);
  }

  const proofByMember = new Map<
    string,
    {
      status: string;
      expected_amount: number;
      ocr_raw: unknown;
    }
  >();
  for (const proof of allProofs ?? []) {
    proofByMember.set(`${proof.group_id}:${proof.from_member_id}`, proof);
  }

  const rows = await Promise.all(
    memberships.map(async (m) => {
      const g = m.groups as unknown as
        | { id: string; name: string }
        | { id: string; name: string }[]
        | null;
      const group = Array.isArray(g) ? g[0] : g;
      if (!group) return null;

      const groupId = m.group_id as string;
      const memberIds = memberIdsByGroup.get(groupId) ?? [];
      if (!memberIds.length) return null;

      const payments = await getGroupMemberPayments(supabase, groupId, memberIds, {
        includeReceiptDetails: true,
      });
      const pay = payments.find((payment) => payment.member_id === m.id);
      const payTotal = pay?.total ?? 0;
      const owesTotal = pay?.owes ?? payTotal;
      const isBillPayer = pay?.is_bill_payer ?? false;
      const currency = pay?.currency ?? "PHP";

      let unpaid = owesTotal;
      let paid = false;

      const proof = proofByMember.get(`${groupId}:${m.id}`);

      if (owesTotal > 0 || isBillPayer) {
        const proofMeta = parsePaymentProofSource(proof?.ocr_raw);
        paid = isMemberMarkedPaid(
          owesTotal,
          proof
            ? {
                status: proof.status,
                expected_amount: Number(proof.expected_amount),
                ...proofMeta,
              }
            : null
        );
        if (paid && owesTotal > 0) unpaid = 0;
      }

      return {
        groupId,
        groupName: group.name,
        owes: moneyNumber(unpaid),
        share: moneyNumber(payTotal),
        currency,
        isBillPayer,
        isPaid: paid && (owesTotal > 0 || isBillPayer),
        receipts: pay?.receipts ?? [],
      } satisfies UserGroupPayableRow;
    })
  );

  const groups = rows
    .filter((row): row is UserGroupPayableRow => row != null && row.owes > 0)
    .sort((a, b) => b.owes - a.owes);

  let totalOwes = 0;
  let currency = "PHP";
  for (const row of groups) {
    totalOwes = moneyNumber(totalOwes + row.owes);
    currency = row.currency || currency;
  }

  return { totalOwes, currency, groups };
}
