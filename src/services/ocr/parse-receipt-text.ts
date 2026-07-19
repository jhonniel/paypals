/**
 * Shared receipt text → structured fields parser.
 * Handles common PH POS layouts (name / qty×price / modifiers).
 */

import type { OcrLineItem, OcrResult, OcrProviderName } from "@/services/ocr/types";
import { moneyNumber, d } from "@/lib/money";

const TOTAL_RE = /(?:grand\s*)?total|amount\s*due|balance\s*due|amount\s*payable/i;
const SUBTOTAL_RE = /sub\s*total|subtotal|merchandise/i;
const TAX_AMOUNT_RE = /vat\s*amount|sales\s*tax|\btax\b(?!\s*exempt)/i;
const TIP_RE = /(?:tip|gratuity)/i;
const DISCOUNT_RE = /(?:discount|promo)/i;
const SERVICE_RE = /(?:service\s*charge|\bsvc\b)/i;

/** Lines that are never menu items or should be ignored as noise. */
const SKIP_RE =
  /^(?:owned\s*by|vat\s*reg|tin:?|min:|serial|sales\s*invoice|invoice|description|amount|table:|pax:|si#|trans#|cashier|terminal|thank|change|cash|card|gcash|paymaya|maya|vatable|vat\s*exempt|zero\s*rated|other\s*tax|customer\s*info|name$|address$|ref|bir|tel|phone|www\.|http|l-\d|bldg|avenue|barangay|district|city|davao|poblacion|laurel|pryce|ascendido|ground\s*floor)/i;

const DATE_RE =
  /(\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})|(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/;
const TIME_RE = /(\d{1,2}:\d{2}(?::\d{2})?)/;

/** `1 x 225.00` or `1 X 225.00  225.00` or `x 220.00  220.00` */
const QTY_PRICE_RE =
  /^(\d+)?\s*[x×]\s*([\d,]+\.\d{2})(?:\s+([\d,]+\.\d{2}))?\s*$/i;

const MODIFIER_RE = /^[\-–—•*]/;

function parseMoney(raw: string): number | null {
  const m = raw.replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)/);
  if (!m) return null;
  return moneyNumber(m[1]);
}

function normalizeLine(line: string): string {
  return line
    .replace(/\t+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/(\d),(\d{2})\b/g, "$1.$2") // 240,00 → 240.00
    .trim();
}

function isSkipLine(line: string): boolean {
  if (!line || line.length < 2) return true;
  if (/^[\-=_]{3,}$/.test(line)) return true;
  if (SKIP_RE.test(line)) return true;
  if (/^vat\s*reg/i.test(line)) return true;
  return false;
}

function isSummaryLabel(line: string): boolean {
  return (
    TOTAL_RE.test(line) ||
    SUBTOTAL_RE.test(line) ||
    TAX_AMOUNT_RE.test(line) ||
    TIP_RE.test(line) ||
    DISCOUNT_RE.test(line) ||
    SERVICE_RE.test(line)
  );
}

function looksLikeItemName(line: string): boolean {
  if (isSkipLine(line) || isSummaryLabel(line) || MODIFIER_RE.test(line)) return false;
  if (QTY_PRICE_RE.test(line)) return false;
  if (DATE_RE.test(line) && line.length < 30) return false;
  if (!/[a-zA-Z]{3,}/.test(line)) return false;
  if (line.length > 48) return false;
  return true;
}

function extractQtyPrice(line: string): {
  quantity: number;
  unitPrice: number;
  totalPrice: number;
} | null {
  const m = line.match(QTY_PRICE_RE);
  if (!m) return null;
  const quantity = Math.max(1, Number(m[1] || 1));
  const unitPrice = parseMoney(m[2]);
  if (unitPrice === null) return null;
  const explicitTotal = m[3] ? parseMoney(m[3]) : null;
  const totalPrice =
    explicitTotal !== null ? explicitTotal : moneyNumber(d(unitPrice).mul(quantity));
  return { quantity, unitPrice, totalPrice };
}

/**
 * PH POS pattern:
 *   MATCHA COFFEE LATTE
 *   1 X 225.00    225.00
 *   -TALL, ICE, DINE IN
 */
function extractPosItems(lines: string[]): OcrLineItem[] {
  const items: OcrLineItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const qty = extractQtyPrice(line);
    if (!qty) continue;

    let name: string | null = null;
    for (let j = i - 1; j >= 0; j--) {
      const prev = lines[j];
      if (MODIFIER_RE.test(prev)) continue;
      if (extractQtyPrice(prev)) break;
      if (isSummaryLabel(prev) || isSkipLine(prev)) break;
      if (looksLikeItemName(prev)) {
        name = prev;
        break;
      }
      const moneyAtEnd = prev.match(/^(.*?)([\d,]+\.\d{2})\s*$/);
      if (moneyAtEnd && looksLikeItemName(moneyAtEnd[1].trim())) {
        name = moneyAtEnd[1].trim();
        break;
      }
    }

    if (!name) continue;

    items.push({
      name: name.replace(/^[\d.]+\s+/, "").slice(0, 80),
      quantity: qty.quantity,
      unitPrice: qty.unitPrice,
      totalPrice: qty.totalPrice,
    });
  }

  return items;
}

/** Fallback: single-line "Item name 99.00" */
function extractInlineItems(lines: string[]): OcrLineItem[] {
  const items: OcrLineItem[] = [];
  for (const line of lines) {
    if (isSkipLine(line) || isSummaryLabel(line) || MODIFIER_RE.test(line)) continue;
    if (extractQtyPrice(line)) continue;
    if (DATE_RE.test(line)) continue;

    const moneyMatch = [...line.matchAll(/([\d,]+\.\d{2})/g)];
    if (moneyMatch.length === 0) continue;
    const last = moneyMatch[moneyMatch.length - 1];
    const price = parseMoney(last[1]);
    if (price === null || price <= 0) continue;

    let name = line.slice(0, last.index ?? 0).trim().replace(/[.\-–—:]+$/, "").trim();
    let quantity = 1;
    const qtyMatch = name.match(/^(\d+(?:\.\d+)?)\s*[x×]\s*(.+)$/i);
    if (qtyMatch) {
      quantity = Number(qtyMatch[1]) || 1;
      name = qtyMatch[2].trim();
    }
    if (!name || name.length < 3 || !/[a-zA-Z]{3,}/.test(name)) continue;
    if (isSkipLine(name) || isSummaryLabel(name)) continue;

    items.push({
      name: name.slice(0, 80),
      quantity,
      unitPrice: quantity > 1 ? moneyNumber(d(price).div(quantity)) : price,
      totalPrice: price,
    });
  }
  return items;
}

function pickMerchant(lines: string[]): string | null {
  for (const line of lines.slice(0, 8)) {
    if (isSkipLine(line)) continue;
    if (/cafe|coffee|restaurant|kitchen|bistro|pizza|grill|mr\.?\s*wen/i.test(line)) {
      const cafeOnly = line.match(/^(.+?\bcafe\b)/i);
      return (cafeOnly?.[1] ?? line).slice(0, 80).trim();
    }
  }
  const first = lines.find((l) => looksLikeItemName(l) && l.length <= 40);
  return first?.slice(0, 80) ?? lines[0]?.slice(0, 80) ?? null;
}

function dedupeItems(items: OcrLineItem[]): OcrLineItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.name.toLowerCase()}-${item.totalPrice}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseReceiptText(
  text: string,
  provider: OcrProviderName,
  raw: unknown,
  confidence: number | null = null
): OcrResult {
  const lines = text
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter(Boolean);

  let date: string | null = null;
  let time: string | null = null;
  let subtotal: number | null = null;
  let tax: number | null = null;
  let discount: number | null = null;
  let serviceCharge: number | null = null;
  let tip: number | null = null;
  let total: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const dateMatch = line.match(DATE_RE);
    if (dateMatch && !date) date = dateMatch[0];

    const timeMatch = line.match(TIME_RE);
    if (timeMatch && !time) {
      const hm = timeMatch[0].match(/^(\d{1,2}):(\d{2})/);
      if (hm) {
        const h = Number(hm[1]);
        const m = Number(hm[2]);
        if (h >= 0 && h <= 23 && m >= 0 && m <= 59) time = timeMatch[0];
      }
    }

    const moneyOnLine = (() => {
      const all = [...line.matchAll(/([\d,]+\.\d{2})/g)];
      if (!all.length) return null;
      return parseMoney(all[all.length - 1][1]);
    })();

    const nextMoney = (() => {
      const next = lines[i + 1];
      if (!next) return null;
      if (/^[\d,]+\.\d{2}$/.test(next)) return parseMoney(next);
      return null;
    })();

    const amount = moneyOnLine ?? nextMoney;
    if (amount === null) continue;

    // Prefer Amount due as the receipt total; do not use VAT/tax in the bill.
    if (/amount\s*due|balance\s*due|amount\s*payable/i.test(line)) {
      total = amount;
    } else if (
      total === null &&
      TOTAL_RE.test(line) &&
      !/sub/i.test(line) &&
      !TAX_AMOUNT_RE.test(line)
    ) {
      total = amount;
    } else if (SUBTOTAL_RE.test(line)) {
      subtotal = amount;
    } else if (TIP_RE.test(line)) {
      tip = amount;
    } else if (DISCOUNT_RE.test(line)) {
      discount = amount;
    } else if (SERVICE_RE.test(line)) {
      serviceCharge = amount;
    }
  }

  // Never carry tax into Paypals — amount due / item totals are enough
  tax = null;

  let items = dedupeItems(extractPosItems(lines));
  if (items.length < 2) {
    const inline = dedupeItems(extractInlineItems(lines));
    if (inline.length > items.length) items = inline;
  }

  if (total !== null) {
    items = items.filter(
      (i) =>
        !(
          Math.abs(i.totalPrice - total!) < 0.001 &&
          /paymaya|gcash|cash|card|amount|due|total|subtotal/i.test(i.name)
        )
    );
  }

  items = items.filter(
    (i) => !/vatable|vat\s*amount|exempt|zero\s*rated|other\s*tax|paymaya/i.test(i.name)
  );

  if (items.length === 0 && total !== null) {
    items.push({
      name: "Receipt total",
      quantity: 1,
      unitPrice: total,
      totalPrice: total,
    });
  }

  if (subtotal === null && items.length > 0) {
    subtotal = moneyNumber(items.reduce((s, i) => s.plus(i.totalPrice), d(0)));
  }

  if (items.length > 0 && total === null) {
    total = moneyNumber(items.reduce((s, i) => s.plus(i.totalPrice), d(0)));
  }

  return {
    provider,
    merchant: pickMerchant(lines),
    date,
    time,
    items,
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
