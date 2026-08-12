import type { SupabaseClient } from "@supabase/supabase-js";
import { moneyNumber } from "@/lib/money";
import { todayInManila } from "@/lib/payment-proof";
import { getGroupMemberPayments } from "@/lib/group-member-payments";

/**
 * After a bill payer confirms their item picks, mark them paid for the group.
 * They already paid at the restaurant — nothing to pay back.
 */
export async function autoSettleBillPayerAfterClaim(
  supabase: SupabaseClient,
  groupId: string,
  memberId: string
): Promise<void> {
  const { data: members } = await supabase
    .from("group_members")
    .select("id")
    .eq("group_id", groupId);
  const memberIds = (members ?? []).map((m) => m.id);
  if (!memberIds.includes(memberId)) return;

  const payments = await getGroupMemberPayments(supabase, groupId, memberIds);
  const mine = payments.find((p) => p.member_id === memberId);
  if (!mine?.is_bill_payer || mine.owes > 0 || mine.total <= 0) return;

  const row = {
    group_id: groupId,
    from_member_id: memberId,
    to_member_id: memberId,
    expected_amount: moneyNumber(mine.total),
    ocr_amount: moneyNumber(mine.total),
    ocr_date: todayInManila(),
    currency: mine.currency || "PHP",
    status: "paid" as const,
    proof_storage_path: null,
    proof_mime: null,
    rejection_reason: null,
    ocr_raw: {
      source: "bill_payer",
      auto_settled_at: new Date().toISOString(),
    },
    validated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("group_payment_proofs")
    .upsert(row, { onConflict: "group_id,from_member_id" });

  if (error) {
    console.error("autoSettleBillPayerAfterClaim:", error.message);
  }
}
