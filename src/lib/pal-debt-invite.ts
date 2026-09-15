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

export function pendingPalCounterpartyId(debtId: string) {
  return `pending:${debtId}`;
}

export function isPendingPalCounterpartyId(id: string) {
  return id.startsWith("pending:");
}
