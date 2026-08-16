import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { moneyNumber } from "@/lib/money";
import { getMemberGroupPayTotal } from "@/lib/group-member-payments";
import { applyPalDebtorCredit } from "@/lib/pal-debt-balance";
import { todayInManila } from "@/lib/payment-proof";

export async function resolveBillPayerMemberId(
  supabase: SupabaseClient,
  groupId: string,
  fallbackMemberId: string
) {
  const { data: receipts } = await supabase
    .from("receipts")
    .select("paid_by_member_id")
    .eq("group_id", groupId)
    .not("paid_by_member_id", "is", null)
    .limit(1);

  return (
    (receipts ?? []).find((r) => r.paid_by_member_id)?.paid_by_member_id ??
    fallbackMemberId
  );
}

export type MoveGroupMemberToPalResult = {
  member_id: string;
  pal_debt_id: string;
  amount: number;
  currency: string;
  description: string;
  status: "moved_to_pal";
};

export type MoveGroupMemberToPalContext = {
  supabase: SupabaseClient;
  userId: string;
  groupId: string;
  groupName: string;
  toMemberId: string;
  creditorId: string;
  writer: SupabaseClient;
};

export async function moveGroupMemberToPalDebt(
  ctx: MoveGroupMemberToPalContext,
  memberId: string
): Promise<MoveGroupMemberToPalResult> {
  const { supabase, userId, groupId, groupName, toMemberId, creditorId, writer } =
    ctx;

  const { data: target } = await supabase
    .from("group_members")
    .select("id, user_id, guest_name")
    .eq("id", memberId)
    .eq("group_id", groupId)
    .maybeSingle();

  if (!target) throw new Error("Member not found in this group");
  if (!target.user_id) {
    throw new Error("Member must have a Paypals account before moving to Pal owes me");
  }

  const { data: existingProof } = await supabase
    .from("group_payment_proofs")
    .select("status, ocr_raw")
    .eq("group_id", groupId)
    .eq("from_member_id", target.id)
    .maybeSingle();

  const existingSource = (existingProof?.ocr_raw as { source?: string } | null)?.source;
  if (existingProof?.status === "paid") {
    if (existingSource === "moved_to_pal") {
      throw new Error("Already moved to Pal owes me");
    }
    throw new Error("Member is already marked paid in this group");
  }

  const pay = await getMemberGroupPayTotal(supabase, groupId, target.id);
  if (!pay) throw new Error("Could not compute member payment");
  if (pay.total <= 0) {
    throw new Error("This member has nothing to pay in the group");
  }

  const debtorId = target.user_id as string;
  if (creditorId === debtorId) {
    throw new Error("Cannot move a balance to yourself");
  }

  const description = `From group: ${groupName}`;
  const amount = moneyNumber(pay.total);
  const currency = pay.currency || "PHP";

  const insertRow: Record<string, unknown> = {
    creditor_id: creditorId,
    debtor_id: debtorId,
    amount,
    amount_received: 0,
    currency,
    description,
    status: "open",
    settled_at: null,
    source_group_id: groupId,
    source_member_id: target.id,
  };

  let { data: palDebt, error: palErr } = await writer
    .from("pal_debts")
    .insert(insertRow)
    .select("id")
    .single();

  if (palErr && /source_group_id|source_member_id|column/i.test(palErr.message)) {
    const { source_group_id: _g, source_member_id: _m, ...legacyRow } = insertRow;
    const legacy = await writer
      .from("pal_debts")
      .insert(legacyRow)
      .select("id")
      .single();
    palErr = legacy.error;
    palDebt = legacy.data;
  }

  if (palErr) throw new Error(palErr.message);

  const palDebtId = palDebt?.id as string;

  try {
    await applyPalDebtorCredit(
      creditorId === userId ? supabase : writer,
      creditorId,
      debtorId
    );
  } catch (e) {
    console.error("applyPalDebtorCredit after group move", e);
  }

  const proofRow = {
    group_id: groupId,
    from_member_id: target.id,
    to_member_id: toMemberId,
    expected_amount: amount,
    ocr_amount: amount,
    ocr_date: todayInManila(),
    currency,
    status: "paid" as const,
    proof_storage_path: null,
    proof_mime: null,
    rejection_reason: null,
    ocr_raw: {
      source: "moved_to_pal",
      moved_by: userId,
      moved_at: new Date().toISOString(),
      pal_debt_id: palDebtId,
      group_id: groupId,
      group_name: groupName,
    },
    validated_at: new Date().toISOString(),
  };

  const { error: proofErr } = await supabase
    .from("group_payment_proofs")
    .upsert(proofRow, { onConflict: "group_id,from_member_id" });

  if (proofErr) {
    await writer.from("pal_debts").delete().eq("id", palDebtId);
    throw new Error(proofErr.message);
  }

  return {
    member_id: target.id,
    pal_debt_id: palDebtId,
    amount,
    currency,
    description,
    status: "moved_to_pal",
  };
}

export function getPalDebtWriter(
  supabase: SupabaseClient,
  creditorId: string,
  userId: string
): SupabaseClient | null {
  if (creditorId === userId) return supabase;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return createAdminClient();
  return null;
}
