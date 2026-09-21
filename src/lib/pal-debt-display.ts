export type PalDebtPendingFields = {
  id: string;
  creditor_id: string | null;
  debtor_id: string | null;
  pending_debtor_name?: string | null;
  pending_debtor_email?: string | null;
  pending_creditor_name?: string | null;
  pending_creditor_email?: string | null;
};

export type PalPerspective = "creditor" | "debtor";

export function pendingPartyNameFromDebt(
  debt: PalDebtPendingFields,
  perspective: PalPerspective
): string | null {
  if (perspective === "creditor" && !debt.debtor_id) {
    return debt.pending_debtor_name?.trim() || null;
  }
  if (perspective === "debtor" && !debt.creditor_id) {
    return debt.pending_creditor_name?.trim() || null;
  }
  return null;
}

export function pendingPartyEmailFromDebt(
  debt: PalDebtPendingFields,
  perspective: PalPerspective
): string | null {
  if (perspective === "creditor" && !debt.debtor_id) {
    return debt.pending_debtor_email?.trim() || null;
  }
  if (perspective === "debtor" && !debt.creditor_id) {
    return debt.pending_creditor_email?.trim() || null;
  }
  return null;
}

export function pendingPartyNameFromDebts(
  debts: PalDebtPendingFields[],
  perspective: PalPerspective
): string | null {
  for (const debt of debts) {
    const name = pendingPartyNameFromDebt(debt, perspective);
    if (name) return name;
  }
  return null;
}

export function pendingPartyEmailFromDebts(
  debts: PalDebtPendingFields[],
  perspective: PalPerspective
): string | null {
  for (const debt of debts) {
    const email = pendingPartyEmailFromDebt(debt, perspective);
    if (email) return email;
  }
  return null;
}

export function pendingPartyKeyFromDebt(
  debt: PalDebtPendingFields,
  perspective: PalPerspective
): string | null {
  const name = pendingPartyNameFromDebt(debt, perspective);
  if (!name) return null;
  const normalized = name.toLowerCase();
  return perspective === "creditor"
    ? `pending-name:${normalized}`
    : `pending-creditor-name:${normalized}`;
}

export function displayPalCounterpartyName(
  profile: { full_name?: string | null; username?: string | null; email?: string | null } | null | undefined,
  debts: PalDebtPendingFields[],
  perspective: PalPerspective,
  fallback = "Someone"
): string {
  const pending = pendingPartyNameFromDebts(debts, perspective);
  if (pending) return pending;
  if (!profile) return fallback;
  return (
    profile.full_name?.trim() ||
    profile.username ||
    profile.email ||
    fallback
  );
}
