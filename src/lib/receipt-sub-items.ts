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
