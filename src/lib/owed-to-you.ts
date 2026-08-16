import {
  computeOwesToPayer,
  computeSplitBalances,
  type AssignmentInput,
  type ItemSplitInput,
  type ItemSplitMode,
} from "@/lib/splits";
import {
  isMemberMarkedPaid,
  parsePaymentProofSource,
  resolveReceiptPayerMemberId,
} from "@/lib/group-member-payments";
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

type ReceiptRow = {
  id: string;
  currency: string | null;
  tax: number | null;
  discount: number | null;
  service_charge: number | null;
  tip: number | null;
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

async function loadGroupReceiptsForOwed(
  supabase: SupabaseClient,
  groupIds: string[]
): Promise<ReceiptRow[]> {
  if (!groupIds.length) return [];

  const res = await supabase
    .from("receipts")
    .select(
      "id, currency, tax, discount, service_charge, tip, paid_by_member_id, group_id"
    )
    .in("group_id", groupIds)
    .order("created_at", { ascending: false })
    .limit(200);

  if (res.error && /paid_by_member_id|column/i.test(res.error.message)) {
    const fallback = await supabase
      .from("receipts")
      .select("id, currency, tax, discount, service_charge, tip, group_id")
      .in("group_id", groupIds)
      .order("created_at", { ascending: false })
      .limit(200);
    if (fallback.error) return [];
    return (fallback.data ?? []).map((row) => ({
      ...row,
      paid_by_member_id: null,
    })) as ReceiptRow[];
  }

  if (res.error) return [];
  return (res.data ?? []) as ReceiptRow[];
}

async function loadReceiptItemsForOwed(
  supabase: SupabaseClient,
  receiptIds: string[]
): Promise<ItemRow[]> {
  if (!receiptIds.length) return [];

  const res = await supabase
    .from("receipt_items")
    .select("id, receipt_id, name, quantity, total_price, split_mode, split_n")
    .in("receipt_id", receiptIds);

  if (res.error && /split_mode|split_n|column/i.test(res.error.message)) {
    const fallback = await supabase
      .from("receipt_items")
      .select("id, receipt_id, name, quantity, total_price")
      .in("receipt_id", receiptIds);
    if (fallback.error) return [];
    return (fallback.data ?? []) as ItemRow[];
  }

  if (res.error) return [];
  return (res.data ?? []) as ItemRow[];
}

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

/**
 * Aggregate who still owes the current user on bills they paid.
 * Uses the same bill-payer rules as the group page (explicit payer or group owner).
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
  const groupIds = [...new Set((myMemberships ?? []).map((m) => m.group_id as string))];
  if (myMemberIds.length === 0 || groupIds.length === 0) {
    return { rows: [], totalOwed: 0 };
  }

  const [receipts, { data: groups }, { data: members }] = await Promise.all([
    loadGroupReceiptsForOwed(supabase, groupIds),
    supabase.from("groups").select("id, created_by").in("id", groupIds),
    supabase
      .from("group_members")
      .select(
        "id, group_id, user_id, role, guest_name, profiles:user_id(full_name, username, email)"
      )
      .in("group_id", groupIds),
  ]);

  if (!receipts.length) {
    return { rows: [], totalOwed: 0 };
  }

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

  if (!myReceipts.length) {
    return { rows: [], totalOwed: 0 };
  }

  const receiptIds = myReceipts.map((r) => r.id);
  const items = await loadReceiptItemsForOwed(supabase, receiptIds);

  const itemIds = items.map((i) => i.id);
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
  const itemsByReceipt = new Map<string, ItemRow[]>();
  for (const item of items) {
    const list = itemsByReceipt.get(item.receipt_id) ?? [];
    list.push(item);
    itemsByReceipt.set(item.receipt_id, list);
  }

  type GroupMemberAcc = {
    groupId: string;
    memberId: string;
    userId: string | null;
    name: string;
    amount: number;
    currency: string;
    receiptIds: Set<string>;
  };
  const byGroupMember = new Map<string, GroupMemberAcc>();

  for (const receipt of myReceipts) {
    const groupId = receipt.group_id!;
    const paidBy = resolveReceiptPayerMemberId(
      receipt.paid_by_member_id,
      defaultPayerByGroup.get(groupId)
    );
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
        splitMode: (item.split_mode as ItemSplitMode) ?? "among_n",
        splitN: item.split_n ?? null,
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
        equalServiceChargeMemberIds: memberIdsByGroup.get(groupId) ?? [],
        groupMemberIds: memberIdsByGroup.get(groupId) ?? [],
      }
    );

    const owes = computeOwesToPayer(summary, paidBy);
    const currency = receipt.currency ?? "PHP";

    for (const o of owes) {
      if (o.amount <= 0) continue;
      const from = memberById.get(o.fromMemberId);
      if (from?.user_id === userId) continue;

      const gmKey = `${groupId}:${o.fromMemberId}`;
      const existing = byGroupMember.get(gmKey);
      if (existing) {
        existing.amount = moneyNumber(existing.amount + o.amount);
        existing.receiptIds.add(receipt.id);
      } else {
        byGroupMember.set(gmKey, {
          groupId,
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

  const { data: paidProofs } = await supabase
    .from("group_payment_proofs")
    .select(
      "group_id, from_member_id, status, expected_amount, ocr_amount, ocr_raw"
    )
    .eq("status", "paid")
    .in("to_member_id", myMemberIds);

  const proofsByGroupMember = new Map<
    string,
    {
      status: string;
      expected_amount: number;
      ocr_amount: number | null;
      manual: boolean;
      bill_payer: boolean;
    }
  >();
  for (const p of paidProofs ?? []) {
    const proofMeta = parsePaymentProofSource(p.ocr_raw);
    proofsByGroupMember.set(`${p.group_id}:${p.from_member_id}`, {
      status: p.status,
      expected_amount: Number(p.expected_amount),
      ocr_amount: p.ocr_amount != null ? Number(p.ocr_amount) : null,
      ...proofMeta,
    });
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

  for (const entry of byGroupMember.values()) {
    const proof = proofsByGroupMember.get(`${entry.groupId}:${entry.memberId}`);
    if (isMemberMarkedPaid(entry.amount, proof)) continue;

    let amount = entry.amount;
    if (proof?.status === "paid") {
      const paidAmt = moneyNumber(proof.ocr_amount ?? proof.expected_amount);
      amount = moneyNumber(Math.max(0, amount - paidAmt));
    }
    if (amount <= 0) continue;

    const key = entry.userId ?? entry.memberId;
    const existing = owed.get(key);
    if (existing) {
      existing.amount = moneyNumber(existing.amount + amount);
      for (const rid of entry.receiptIds) existing.receiptIds.add(rid);
    } else {
      owed.set(key, {
        memberId: entry.memberId,
        userId: entry.userId,
        name: entry.name,
        amount,
        currency: entry.currency,
        receiptIds: new Set(entry.receiptIds),
      });
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
