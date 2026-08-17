export type ReceiptSubItem = {
  name: string;
  /** Optional add-on price; omit/0 for label-only modifiers */
  amount?: number | null;
  /** Nested detail under this sub-item (e.g. size under a drink) */
  sub_items?: ReceiptSubItem[];
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
    const nestedRaw =
      (entry as { sub_items?: unknown }).sub_items ??
      (entry as { subItems?: unknown }).subItems;
    const nested = normalizeSubItems(nestedRaw);
    out.push({
      name: name.slice(0, 120),
      amount: amount != null && Number.isFinite(amount) ? amount : null,
      ...(nested.length ? { sub_items: nested } : {}),
    });
  }
  return out;
}

/** OCR / API camelCase shape (recursive). */
export type OcrSubItemShape = {
  name: string;
  amount?: number | null;
  subItems?: OcrSubItemShape[];
};

export function toOcrSubItems(items: ReceiptSubItem[]): OcrSubItemShape[] {
  return items.map((s) => ({
    name: s.name,
    amount: s.amount,
    ...(s.sub_items?.length ? { subItems: toOcrSubItems(s.sub_items) } : {}),
  }));
}

/** Scale modifier amounts to match a member's share of the parent line. */
export function scaleSubItemsForShare(
  items: ReceiptSubItem[],
  ratio: number
): ReceiptSubItem[] {
  if (!items.length || ratio >= 0.9999) return items;
  const scale = (amount: number | null | undefined) => {
    if (amount == null || amount <= 0) return amount ?? null;
    return Math.round(amount * ratio * 100) / 100;
  };
  return items.map((entry) => ({
    ...entry,
    amount: scale(entry.amount),
    ...(entry.sub_items?.length
      ? { sub_items: scaleSubItemsForShare(entry.sub_items, ratio) }
      : {}),
  }));
}
