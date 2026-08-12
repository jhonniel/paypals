import type { SupabaseClient } from "@supabase/supabase-js";
import { moneyNumber } from "@/lib/money";
import {
  getGroupMemberPayments,
  isMemberMarkedPaid,
  parsePaymentProofSource,
  type MemberPaymentReceipt,
} from "@/lib/group-member-payments";

export type FriendGroupUnpaid = {
  group_id: string;
  group_name: string;
  member_id: string;
  unpaid_total: number;
  currency: string;
  receipts: MemberPaymentReceipt[];
};

export type FriendUnpaidBalance = {
  user_id: string;
  total_unpaid: number;
  currency: string;
  in_owned_group: boolean;
  groups: FriendGroupUnpaid[];
};

export async function computeFriendUnpaidBalances(
  supabase: SupabaseClient,
  userId: string,
  friendUserIds: string[]
): Promise<Map<string, FriendUnpaidBalance>> {
  const result = new Map<string, FriendUnpaidBalance>();
  for (const fid of friendUserIds) {
    result.set(fid, {
      user_id: fid,
      total_unpaid: 0,
      currency: "PHP",
      in_owned_group: false,
      groups: [],
    });
  }
  if (!friendUserIds.length) return result;

  const friendSet = new Set(friendUserIds);

  const { data: ownedMemberships } = await supabase
    .from("group_members")
    .select("group_id, groups:group_id(id, name)")
    .eq("user_id", userId)
    .eq("role", "owner");

  const ownedGroups = (ownedMemberships ?? []).map((m) => {
    const g = Array.isArray(m.groups) ? m.groups[0] : m.groups;
    return {
      id: m.group_id as string,
      name: (g as { name?: string } | null)?.name ?? "Group",
    };
  });

  if (!ownedGroups.length) return result;

  for (const group of ownedGroups) {
    const { data: members } = await supabase
      .from("group_members")
      .select("id, user_id")
      .eq("group_id", group.id);

    const memberIds = (members ?? []).map((m) => m.id);
    const friendMembers = (members ?? []).filter(
      (m) => m.user_id && friendSet.has(m.user_id)
    );
    if (!friendMembers.length) continue;

    const payments = await getGroupMemberPayments(supabase, group.id, memberIds);

    const { data: proofsRaw } = await supabase
      .from("group_payment_proofs")
      .select(
        "from_member_id, status, expected_amount, ocr_raw"
      )
      .eq("group_id", group.id);

    const proofsByMember = new Map<
      string,
      { status: string; expected_amount: number; manual: boolean }
    >();
    for (const p of proofsRaw ?? []) {
      const proofMeta = parsePaymentProofSource(p.ocr_raw);
      proofsByMember.set(p.from_member_id, {
        status: p.status,
        expected_amount: Number(p.expected_amount),
        ...proofMeta,
      });
    }

    for (const fm of friendMembers) {
      const pay = payments.find((p) => p.member_id === fm.id);
      const owesTotal = pay?.owes ?? pay?.total ?? 0;
      const proof = proofsByMember.get(fm.id);
      const paid = isMemberMarkedPaid(owesTotal, proof);
      if (paid || owesTotal <= 0) continue;

      const friendId = fm.user_id as string;
      const entry = result.get(friendId);
      if (!entry) continue;

      entry.in_owned_group = true;
      entry.groups.push({
        group_id: group.id,
        group_name: group.name,
        member_id: fm.id,
        unpaid_total: owesTotal,
        currency: pay?.currency ?? "PHP",
        receipts: pay?.receipts ?? [],
      });
      entry.total_unpaid = moneyNumber(entry.total_unpaid + owesTotal);
      entry.currency = pay?.currency ?? entry.currency;
    }
  }

  return result;
}
