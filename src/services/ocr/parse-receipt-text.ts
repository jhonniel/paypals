/**
 * Shared receipt text → structured fields parser.
 * Used by OCR.Space / Tesseract / Vision after they return raw text.
 */

import type { OcrLineItem, OcrResult, OcrProviderName } from "@/services/ocr/types";
import { moneyNumber, d } from "@/lib/money";

const PRICE_RE = /(?:₱|PHP|P)?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2}|\d+)/i;
const TOTAL_RE = /(?:grand\s*)?total|amount\s*due|balance\s*due|suma/i;
const SUBTOTAL_RE = /sub\s*total|subtotal|merchandise/i;
const TAX_RE = /(?:vat|tax|gst|sales\s*tax)/i;
const TIP_RE = /(?:tip|gratuity)/i;
const DISCOUNT_RE = /(?:discount|promo|less)/i;
const SERVICE_RE = /(?:service\s*charge|svc)/i;
const DATE_RE = /(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})|(\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})/;
const TIME_RE = /(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)/i;

function parseMoney(raw: string): number | null {
  const m = raw.replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)/);
  if (!m) return null;
  return moneyNumber(m[1]);
}

function looksLikeItem(line: string): boolean {
  if (line.length < 2 || line.length > 80) return false;
  if (TOTAL_RE.test(line) || SUBTOTAL_RE.test(line) || TAX_RE.test(line)) return false;
  if (TIP_RE.test(line) || DISCOUNT_RE.test(line) || SERVICE_RE.test(line)) return false;
  return PRICE_RE.test(line);
}

function splitItem(line: string): OcrLineItem | null {
  const cleaned = line.replace(/\s+/g, " ").trim();
  const matches = [...cleaned.matchAll(/(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})/g)];
  if (matches.length === 0) return null;

  const last = matches[matches.length - 1];
  const price = parseMoney(last[1]);
  if (price === null) return null;

  let name = cleaned.slice(0, last.index).trim().replace(/[.\-–—]+$/, "").trim();
  let quantity = 1;

  const qtyMatch = name.match(/^(\d+(?:\.\d+)?)\s*[x×]\s*(.+)$/i);
  if (qtyMatch) {
    quantity = Number(qtyMatch[1]) || 1;
    name = qtyMatch[2].trim();
  } else {
    const leadingQty = name.match(/^(\d+)\s+(.+)$/);
    if (leadingQty && leadingQty[2].length > 2 && !/^\d/.test(leadingQty[2])) {
      quantity = Number(leadingQty[1]) || 1;
      name = leadingQty[2].trim();
    }
  }

  if (!name || name.length < 2) name = "Item";

  const unitPrice =
    quantity > 1 ? moneyNumber(d(price).div(quantity)) : price;

  return {
    name,
    quantity,
    unitPrice,
    totalPrice: price,
  };
}

export function parseReceiptText(
  text: string,
  provider: OcrProviderName,
  raw: unknown,
  confidence: number | null = null
): OcrResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let merchant: string | null = lines[0]?.slice(0, 80) ?? null;
  if (merchant && PRICE_RE.test(merchant) && lines[1]) {
    merchant = lines[1].slice(0, 80);
  }

  let date: string | null = null;
  let time: string | null = null;
  let subtotal: number | null = null;
  let tax: number | null = null;
  let discount: number | null = null;
  let serviceCharge: number | null = null;
  let tip: number | null = null;
  let total: number | null = null;
  const items: OcrLineItem[] = [];

  for (const line of lines) {
    const dateMatch = line.match(DATE_RE);
    if (dateMatch && !date) date = dateMatch[0];

    const timeMatch = line.match(TIME_RE);
    if (timeMatch && !time) time = timeMatch[0];

    const amount = parseMoney(line);

    if (amount !== null) {
      if (TOTAL_RE.test(line) && !SUBTOTAL_RE.test(line)) total = amount;
      else if (SUBTOTAL_RE.test(line)) subtotal = amount;
      else if (TAX_RE.test(line)) tax = amount;
      else if (TIP_RE.test(line)) tip = amount;
      else if (DISCOUNT_RE.test(line)) discount = amount;
      else if (SERVICE_RE.test(line)) serviceCharge = amount;
      else if (looksLikeItem(line)) {
        const item = splitItem(line);
        if (item) items.push(item);
      }
    }
  }

  // Deduplicate near-identical item names keeping first
  const seen = new Set<string>();
  const uniqueItems = items.filter((item) => {
    const key = `${item.name.toLowerCase()}-${item.totalPrice}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (uniqueItems.length === 0 && total !== null) {
    uniqueItems.push({
      name: "Receipt total",
      quantity: 1,
      unitPrice: total,
      totalPrice: total,
    });
  }

  if (subtotal === null && uniqueItems.length > 0) {
    subtotal = moneyNumber(
      uniqueItems.reduce((s, i) => s.plus(i.totalPrice), d(0))
    );
  }

  return {
    provider,
    merchant,
    date,
    time,
    items: uniqueItems,
    subtotal,
    tax,
    discount,
    serviceCharge,
    tip,
    total,
    confidence,
    raw,
  };
}
