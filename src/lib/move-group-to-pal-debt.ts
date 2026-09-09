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

type MovedPalProofMeta = {
  source?: string;
  pal_debt_id?: string;
  moved_by?: string;
};

async function findMovedGroupProof(
  supabase: SupabaseClient,
  palDebtId: string,
  sourceGroupId?: string | null,
  sourceMemberId?: string | null
) {
  if (sourceGroupId && sourceMemberId) {
    const { data: proof } = await supabase
      .from("group_payment_proofs")
      .select("group_id, from_member_id, ocr_raw")
      .eq("group_id", sourceGroupId)
      .eq("from_member_id", sourceMemberId)
      .maybeSingle();

    if (!proof) return null;
    const meta = (proof.ocr_raw ?? {}) as MovedPalProofMeta;
    if (meta.source !== "moved_to_pal") return null;
    if (meta.pal_debt_id && meta.pal_debt_id !== palDebtId) return null;
    return proof;
  }

  const { data: proofs } = await supabase
    .from("group_payment_proofs")
    .select("group_id, from_member_id, ocr_raw")
    .eq("status", "paid")
    .contains("ocr_raw", { source: "moved_to_pal", pal_debt_id: palDebtId });

  const proof = proofs?.[0];
  if (!proof) return null;
  const meta = (proof.ocr_raw ?? {}) as MovedPalProofMeta;
  if (meta.source !== "moved_to_pal") return null;
  if (meta.pal_debt_id && meta.pal_debt_id !== palDebtId) return null;
  return proof;
}

/** Clear group "Moved to Pal owes me" when the linked pal debt is deleted. */
export async function restoreGroupMemberFromPalDebt(
  supabase: SupabaseClient,
  userId: string,
  palDebt: {
    id: string;
    creditor_id: string;
    source_group_id?: string | null;
    source_member_id?: string | null;
  }
): Promise<{ restored: boolean; group_id?: string; member_id?: string }> {
  if (palDebt.creditor_id !== userId) {
    throw new Error("Only the creditor can restore the group balance");
  }

  const proof = await findMovedGroupProof(
    supabase,
    palDebt.id,
    palDebt.source_group_id,
    palDebt.source_member_id
  );

  if (!proof) {
    return { restored: false };
  }

  const groupId = proof.group_id as string;
  const memberId = proof.from_member_id as string;
  await deleteMovedToPalProof(supabase, groupId, memberId);

  return { restored: true, group_id: groupId, member_id: memberId };
}

async function deleteMovedToPalProof(
  supabase: SupabaseClient,
  groupId: string,
  memberId: string
) {
  const { error: deleteErr } = await supabase
    .from("group_payment_proofs")
    .delete()
    .eq("group_id", groupId)
    .eq("from_member_id", memberId);

  if (deleteErr && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { error: adminErr } = await createAdminClient()
      .from("group_payment_proofs")
      .delete()
      .eq("group_id", groupId)
      .eq("from_member_id", memberId);
    if (adminErr) throw new Error(adminErr.message);
  } else if (deleteErr) {
    throw new Error(deleteErr.message);
  }
}

export type RevertGroupMemberFromPalResult = {
  member_id: string;
  pal_debt_id: string | null;
  debtor_id: string | null;
  amount: number;
  currency: string;
};

/** Undo "Move to Pal owes me" — deletes pal debt and restores group balance. */
export async function revertGroupMemberFromPalDebt(
  ctx: MoveGroupMemberToPalContext,
  memberId: string
): Promise<RevertGroupMemberFromPalResult> {
  const { supabase, groupId, creditorId, writer } = ctx;

  const { data: target } = await supabase
    .from("group_members")
    .select("id")
    .eq("id", memberId)
    .eq("group_id", groupId)
    .maybeSingle();

  if (!target) throw new Error("Member not found in this group");

  const { data: proof } = await supabase
    .from("group_payment_proofs")
    .select("expected_amount, currency, ocr_raw, status")
    .eq("group_id", groupId)
    .eq("from_member_id", memberId)
    .maybeSingle();

  if (!proof || proof.status !== "paid") {
    throw new Error("This member was not moved to Pal owes me");
  }

  const meta = (proof.ocr_raw ?? {}) as MovedPalProofMeta;
  if (meta.source !== "moved_to_pal") {
    throw new Error("This member was not moved to Pal owes me");
  }

  let palDebtId = meta.pal_debt_id ?? null;
  let debtorId: string | null = null;

  async function loadPalDebtById(id: string) {
    let query = writer
      .from("pal_debts")
      .select("id, debtor_id")
      .eq("id", id)
      .eq("creditor_id", creditorId)
      .maybeSingle();

    let { data, error } = await query;
    if (
      error &&
      /source_group_id|source_member_id|column/i.test(error.message)
    ) {
      const fallback = await writer
        .from("pal_debts")
        .select("id, debtor_id")
        .eq("id", id)
        .eq("creditor_id", creditorId)
        .maybeSingle();
      data = fallback.data;
      error = fallback.error;
    }
    if (error) throw new Error(error.message);
    return data;
  }

  if (palDebtId) {
    const debt = await loadPalDebtById(palDebtId);
    if (debt) {
      debtorId = debt.debtor_id as string;
    } else {
      palDebtId = null;
    }
  }

  if (!palDebtId) {
    let { data: linked, error: linkErr } = await writer
      .from("pal_debts")
      .select("id, debtor_id")
      .eq("creditor_id", creditorId)
      .eq("source_group_id", groupId)
      .eq("source_member_id", memberId)
      .maybeSingle();

    if (
      linkErr &&
      /source_group_id|source_member_id|column/i.test(linkErr.message)
    ) {
      const { data: memberRow } = await supabase
        .from("group_members")
        .select("user_id")
        .eq("id", memberId)
        .maybeSingle();

      if (memberRow?.user_id) {
        const fallback = await writer
          .from("pal_debts")
          .select("id, debtor_id")
          .eq("creditor_id", creditorId)
          .eq("debtor_id", memberRow.user_id)
          .ilike("description", "From group:%")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        linked = fallback.data;
        linkErr = fallback.error;
      }
    }

    if (linkErr) throw new Error(linkErr.message);
    if (linked) {
      palDebtId = linked.id as string;
      debtorId = linked.debtor_id as string;
    }
  }

  if (palDebtId) {
    const { error: delErr } = await writer
      .from("pal_debts")
      .delete()
      .eq("id", palDebtId)
      .eq("creditor_id", creditorId);
    if (delErr) throw new Error(delErr.message);
  }

  await deleteMovedToPalProof(supabase, groupId, memberId);

  return {
    member_id: memberId,
    pal_debt_id: palDebtId,
    debtor_id: debtorId,
    amount: moneyNumber(Number(proof.expected_amount)),
    currency: (proof.currency as string) || "PHP",
  };
}

type MovedPalProofRow = {
  from_member_id: string;
  expected_amount: number;
  currency: string;
  ocr_raw: unknown;
};

async function resolvePalDebtForMovedMember(
  writer: SupabaseClient,
  supabase: SupabaseClient,
  creditorId: string,
  groupId: string,
  memberId: string,
  palDebtIdHint: string | null
) {
  type PalDebtLookup = {
    id: string;
    amount: number;
    amount_received?: number | null;
    debtor_id: string;
    currency: string;
    status: string;
  };

  async function loadById(id: string) {
    let { data, error } = await writer
      .from("pal_debts")
      .select("id, amount, amount_received, debtor_id, currency, status")
      .eq("id", id)
      .eq("creditor_id", creditorId)
      .maybeSingle();
    if (
      error &&
      /amount_received|source_group_id|source_member_id|column/i.test(error.message)
    ) {
      const fallback = await writer
        .from("pal_debts")
        .select("id, amount, debtor_id, currency, status")
        .eq("id", id)
        .eq("creditor_id", creditorId)
        .maybeSingle();
      data = fallback.data
        ? { ...fallback.data, amount_received: 0 }
        : null;
      error = fallback.error;
    }
    if (error) throw new Error(error.message);
    return data as PalDebtLookup | null;
  }

  if (palDebtIdHint) {
    const byId = await loadById(palDebtIdHint);
    if (byId) return byId;
  }

  let { data: linked, error: linkErr } = await writer
    .from("pal_debts")
    .select("id, amount, amount_received, debtor_id, currency, status")
    .eq("creditor_id", creditorId)
    .eq("source_group_id", groupId)
    .eq("source_member_id", memberId)
    .maybeSingle();

  if (
    linkErr &&
    /source_group_id|source_member_id|amount_received|column/i.test(linkErr.message)
  ) {
    const { data: memberRow } = await supabase
      .from("group_members")
      .select("user_id")
      .eq("id", memberId)
      .maybeSingle();

    if (memberRow?.user_id) {
      const fallback = await writer
        .from("pal_debts")
        .select("id, amount, debtor_id, currency, status")
        .eq("creditor_id", creditorId)
        .eq("debtor_id", memberRow.user_id)
        .ilike("description", "From group:%")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      linked = fallback.data
        ? { ...fallback.data, amount_received: 0 }
        : null;
      linkErr = fallback.error;
    }
  }

  if (linkErr) throw new Error(linkErr.message);
  return (linked as PalDebtLookup | null) ?? null;
}

function getMovedPalSyncWriter(
  supabase: SupabaseClient,
  creditorId: string,
  actorUserId?: string
) {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return createAdminClient();
  if (actorUserId) {
    const writer = getPalDebtWriter(supabase, creditorId, actorUserId);
    if (writer) return writer;
  }
  return supabase;
}

export type SyncMovedPalDebtsResult = {
  updated: Array<{
    member_id: string;
    pal_debt_id: string;
    previous_amount: number;
    new_amount: number;
    currency: string;
  }>;
};

/** Keep Pal owes me amounts in sync when group assignments change. */
export async function syncMovedToPalDebtsForGroup(
  supabase: SupabaseClient,
  groupId: string,
  options?: { memberIds?: string[]; actorUserId?: string }
): Promise<SyncMovedPalDebtsResult> {
  const memberFilter = options?.memberIds?.length
    ? new Set(options.memberIds)
    : null;

  const { data: proofs } = await supabase
    .from("group_payment_proofs")
    .select("from_member_id, expected_amount, currency, ocr_raw")
    .eq("group_id", groupId)
    .eq("status", "paid");

  const movedProofs = (proofs ?? []).filter((row) => {
    const meta = (row.ocr_raw ?? {}) as MovedPalProofMeta;
    if (meta.source !== "moved_to_pal") return false;
    if (memberFilter && !memberFilter.has(row.from_member_id as string)) {
      return false;
    }
    return true;
  }) as MovedPalProofRow[];

  if (!movedProofs.length) {
    return { updated: [] };
  }

  const { data: groupMembers } = await supabase
    .from("group_members")
    .select("id")
    .eq("group_id", groupId);
  const fallbackMemberId = groupMembers?.[0]?.id as string | undefined;
  if (!fallbackMemberId) return { updated: [] };

  const toMemberId = await resolveBillPayerMemberId(
    supabase,
    groupId,
    fallbackMemberId
  );
  const { data: payerMember } = await supabase
    .from("group_members")
    .select("user_id")
    .eq("id", toMemberId)
    .maybeSingle();

  const creditorId = payerMember?.user_id as string | undefined;
  if (!creditorId) return { updated: [] };

  const writer = getMovedPalSyncWriter(
    supabase,
    creditorId,
    options?.actorUserId
  );

  const updated: SyncMovedPalDebtsResult["updated"] = [];

  for (const proof of movedProofs) {
    const memberId = proof.from_member_id as string;
    const pay = await getMemberGroupPayTotal(supabase, groupId, memberId);
    if (!pay) continue;

    const meta = (proof.ocr_raw ?? {}) as MovedPalProofMeta;
    const palDebt = await resolvePalDebtForMovedMember(
      writer,
      supabase,
      creditorId,
      groupId,
      memberId,
      meta.pal_debt_id ?? null
    );
    if (!palDebt || palDebt.status === "cancelled") continue;

    const newAmount = moneyNumber(pay.total);
    if (newAmount <= 0) continue;

    const received = moneyNumber(Number(palDebt.amount_received ?? 0));
    const nextAmount = moneyNumber(Math.max(newAmount, received));
    const previousAmount = moneyNumber(Number(palDebt.amount));

    if (nextAmount === previousAmount) continue;

    const nextStatus = nextAmount <= received ? "paid" : "open";
    const debtPatch: Record<string, unknown> = {
      amount: nextAmount,
      currency: pay.currency || palDebt.currency || proof.currency || "PHP",
      status: nextStatus,
      settled_at: nextStatus === "paid" ? new Date().toISOString() : null,
    };

    let { error: debtErr } = await writer
      .from("pal_debts")
      .update(debtPatch)
      .eq("id", palDebt.id)
      .eq("creditor_id", creditorId);

    if (debtErr && /amount_received|settled_at|column/i.test(debtErr.message)) {
      const legacyPatch = { amount: nextAmount, currency: debtPatch.currency, status: nextStatus };
      const legacy = await writer
        .from("pal_debts")
        .update(legacyPatch)
        .eq("id", palDebt.id)
        .eq("creditor_id", creditorId);
      debtErr = legacy.error;
    }

    if (debtErr) {
      console.error("syncMovedToPalDebtsForGroup pal_debts update", debtErr);
      continue;
    }

    const proofPatch = {
      expected_amount: nextAmount,
      ocr_amount: nextAmount,
      currency: pay.currency || proof.currency || "PHP",
      ocr_raw: {
        ...(proof.ocr_raw as Record<string, unknown>),
        source: "moved_to_pal",
        pal_debt_id: palDebt.id,
        synced_at: new Date().toISOString(),
        synced_amount: nextAmount,
      },
    };

    const { error: proofErr } = await supabase
      .from("group_payment_proofs")
      .update(proofPatch)
      .eq("group_id", groupId)
      .eq("from_member_id", memberId);

    if (proofErr && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      await createAdminClient()
        .from("group_payment_proofs")
        .update(proofPatch)
        .eq("group_id", groupId)
        .eq("from_member_id", memberId);
    } else if (proofErr) {
      console.error("syncMovedToPalDebtsForGroup proof update", proofErr);
    }

    updated.push({
      member_id: memberId,
      pal_debt_id: palDebt.id,
      previous_amount: previousAmount,
      new_amount: nextAmount,
      currency: (debtPatch.currency as string) || "PHP",
    });

    try {
      await applyPalDebtorCredit(writer, creditorId, palDebt.debtor_id as string);
    } catch (e) {
      console.error("applyPalDebtorCredit after moved pal sync", e);
    }
  }

  return { updated };
}
