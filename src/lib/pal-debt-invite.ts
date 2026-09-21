export function palDebtInvitePath(token: string) {
  return `/invite/pal-debt/${token}`;
}

export function palDebtInviteUrl(token: string, origin?: string) {
  const base = (
    origin ??
    (typeof window !== "undefined" ? window.location.origin : "")
  ).replace(/\/$/, "");
  return `${base}${palDebtInvitePath(token)}`;
}

/** Creditor recorded debt; debtor not linked yet. */
export function pendingPalCounterpartyId(debtId: string) {
  return `pending:${debtId}`;
}

/** Debtor recorded debt; creditor not linked yet. */
export function pendingCreditorCounterpartyId(debtId: string) {
  return `pending-creditor:${debtId}`;
}

export function isPendingPalCounterpartyId(id: string) {
  return (
    id.startsWith("pending:") ||
    id.startsWith("pending-creditor:") ||
    id.startsWith("pending-name:") ||
    id.startsWith("pending-creditor-name:")
  );
}
