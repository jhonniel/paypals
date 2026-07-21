export type ReceiptSubItem = {
  name: string;
  /** Optional add-on price; omit/0 for label-only modifiers */
  amount?: number | null;
};

export function normalizeSubItems(raw: unknown): ReceiptSubItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ReceiptSubItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const name = String((entry as { name?: unknown }).name ?? "").trim();
    if (!name) continue;
    const amountRaw = (entry as { amount?: unknown }).amount;
    const amount =
      amountRaw == null || amountRaw === ""
        ? null
        : Number(amountRaw);
    out.push({
      name: name.slice(0, 120),
      amount: amount != null && Number.isFinite(amount) ? amount : null,
    });
  }
  return out;
}
