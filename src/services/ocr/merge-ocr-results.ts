import type { OcrLineItem, OcrResult } from "@/services/ocr/types";
import { parseReceiptText } from "@/services/ocr/parse-receipt-text";

function itemKey(item: OcrLineItem): string {
  return `${item.name.toLowerCase().trim()}|${item.quantity}|${item.totalPrice}`;
}

function pickFirst<T>(...values: Array<T | null | undefined>): T | null {
  for (const v of values) {
    if (v != null && v !== "") return v as T;
  }
  return null;
}

/** OCR.Space and similar providers store plain text under ParsedResults. */
export function extractOcrPlainText(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const parsed = raw as {
    ParsedResults?: Array<{ ParsedText?: string }>;
    text?: string;
  };
  if (Array.isArray(parsed.ParsedResults)) {
    return parsed.ParsedResults.map((r) => r.ParsedText ?? "")
      .join("\n")
      .trim();
  }
  if (typeof parsed.text === "string") return parsed.text.trim();
  return "";
}

/** Merge OCR text from two passes, keeping unique lines in order. */
export function mergeOcrPlainText(a: string, b: string): string {
  const combined = [a, b].filter(Boolean).join("\n");
  if (!combined) return "";

  const seen = new Set<string>();
  const lines: string[] = [];
  for (const line of combined.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  return lines.join("\n");
}

export function mergeOcrResults(primary: OcrResult, secondary: OcrResult): OcrResult {
  const itemsByKey = new Map<string, OcrLineItem>();
  for (const item of [...primary.items, ...secondary.items]) {
    itemsByKey.set(itemKey(item), item);
  }
  const items = Array.from(itemsByKey.values());

  const richer = primary.items.length >= secondary.items.length ? primary : secondary;
  const other = richer === primary ? secondary : primary;

  const discountLines = [
    ...(primary.discountLines ?? []),
    ...(secondary.discountLines ?? []),
  ].filter(
    (line, index, arr) =>
      arr.findIndex(
        (x) =>
          x.label.toLowerCase() === line.label.toLowerCase() && x.amount === line.amount
      ) === index
  );

  const confidenceValues = [primary.confidence, secondary.confidence].filter(
    (v): v is number => v != null
  );

  return {
    provider: primary.provider,
    merchant: pickFirst(richer.merchant, other.merchant),
    date: pickFirst(richer.date, other.date),
    time: pickFirst(richer.time, other.time),
    items,
    subtotal: pickFirst(richer.subtotal, other.subtotal),
    tax: pickFirst(richer.tax, other.tax),
    discount: pickFirst(richer.discount, other.discount),
    discountLines: discountLines.length ? discountLines : undefined,
    serviceCharge: pickFirst(richer.serviceCharge, other.serviceCharge),
    tip: pickFirst(richer.tip, other.tip),
    total: pickFirst(richer.total, other.total, primary.total, secondary.total),
    confidence: confidenceValues.length
      ? Math.max(...confidenceValues)
      : null,
    raw: { primary: primary.raw, secondary: secondary.raw, merged: true },
  };
}

/**
 * Combine two OCR passes — re-parse merged plain text when available, otherwise
 * merge structured fields.
 */
export function combineOcrPasses(
  primary: OcrResult,
  secondary: OcrResult
): OcrResult {
  const mergedText = mergeOcrPlainText(
    extractOcrPlainText(primary.raw),
    extractOcrPlainText(secondary.raw)
  );

  if (mergedText) {
    const reparsed = parseReceiptText(
      mergedText,
      primary.provider,
      { merged: true, primary: primary.raw, secondary: secondary.raw },
      Math.max(primary.confidence ?? 0, secondary.confidence ?? 75) || 75
    );
    const structured = mergeOcrResults(primary, secondary);

    if (reparsed.items.length >= structured.items.length) {
      return {
        ...reparsed,
        merchant: pickFirst(reparsed.merchant, structured.merchant),
        date: pickFirst(reparsed.date, structured.date),
        time: pickFirst(reparsed.time, structured.time),
        subtotal: pickFirst(reparsed.subtotal, structured.subtotal),
        tax: pickFirst(reparsed.tax, structured.tax),
        discount: pickFirst(reparsed.discount, structured.discount),
        discountLines: structured.discountLines?.length
          ? structured.discountLines
          : reparsed.discountLines,
        serviceCharge: pickFirst(reparsed.serviceCharge, structured.serviceCharge),
        tip: pickFirst(reparsed.tip, structured.tip),
        total: pickFirst(reparsed.total, structured.total),
        confidence: structured.confidence,
        raw: { mergedText, primary: primary.raw, secondary: secondary.raw },
      };
    }
  }

  return mergeOcrResults(primary, secondary);
}
