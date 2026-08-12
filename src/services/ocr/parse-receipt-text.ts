/**
 * Shared receipt text → structured fields parser.
 * Handles common PH POS layouts (name / qty×price / modifiers)
 * and delivery/combo receipts with nested sub-items (Chowking-style).
 */

import type { OcrLineItem, OcrResult, OcrProviderName } from "@/services/ocr/types";
import { moneyNumber, d } from "@/lib/money";

const TOTAL_RE = /(?:grand\s*)?total|amount\s*due|balance\s*due|amount\s*payable/i;
const SUBTOTAL_RE = /sub\s*total|subtotal|merchandise/i;
const TAX_AMOUNT_RE = /vat\s*amount|sales\s*tax|\btax\b(?!\s*exempt)/i;
const TIP_RE = /(?:tip|gratuity)/i;
const DISCOUNT_RE = /(?:discount|promo|sc\/pwd|pwd|senior)/i;
const SERVICE_RE = /(?:service\s*charge|\bsvc\b|delivery\s*charge)/i;

/** Currency marks OCR often pastes into item names (₱, PHP, P, $, etc.) */
const CURRENCY_TOKEN_RE =
  /(?:^|[\s:])(?:php|phd|ph|₱|p\s*(?=\d)|usd|us\$|\$|€|£|¥|₩|₹)(?=[\s:]|$)/gi;
const CURRENCY_PREFIX_RE =
  /^(?:php|phd|ph|₱|p|usd|us\$|\$|€|£|¥|₩|₹)[\s.:]*/i;
const CURRENCY_SUFFIX_RE =
  /[\s.:]*(?:php|phd|ph|₱|p|usd|us\$|\$|€|£|¥|₩|₹)\s*$/i;
/** Standalone currency / amount-only noise lines */
const CURRENCY_ONLY_RE =
  /^(?:php|phd|ph|₱|p|usd|us\$|\$|€|£|¥|₩|₹)(?:\s*[\d,]+\.?\d*)?$/i;

/** Lines that are never menu items or should be ignored as noise. */
const SKIP_RE =
  /^(?:owned\s*by|vat\s*reg|tin:?|min:|serial|sales\s*invoice|invoice|description|amount|table:|pax:|si#|trans#|cashier|terminal|thank|change|cash|card|gcash|paymaya|maya|vatable|vat\s*exempt|zero\s*rated|other\s*tax|customer\s*info|name$|address$|ref|bir|tel|phone|www\.|http|l-\d|bldg|avenue|barangay|district|poblacion|ground\s*floor|delivery\s*address|contact\s*number|your\s*chowking|order\s*history)/i;

const DATE_RE =
  /(\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})|(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/;
const TIME_RE = /(\d{1,2}:\d{2}(?::\d{2})?)/;

/** `1 x 225.00` or `1 X ₱225.00  225.00` or `x 220.00  220.00` */
const QTY_PRICE_RE =
  /^(\d+)?\s*[x×]\s*(?:php|₱|p|\$)?\s*([\d,]+\.\d{2})(?:\s+(?:php|₱|p|\$)?\s*([\d,]+\.\d{2}))?\s*$/i;

const MODIFIER_RE = /^[\-–—•*·]/;
const SIZE_OR_OPTION_RE =
  /^(?:regular|large|medium|small|tall|grande|venti|short|solo|family|upsized?|extra|less|no)\b/i;

/** Money amount, optionally wrapped in currency marks */
const MONEY_RE = /(?:php|₱|p|\$)?\s*([\d,]+\.\d{2})\s*(?:php|₱|p|\$)?/gi;

function parseMoney(raw: string): number | null {
  const m = raw
    .replace(/,/g, "")
    .replace(/[₱$€£¥₩₹]/g, "")
    .replace(/\b(?:php|phd|usd|us)\b/gi, "")
    .match(/(\d+(?:\.\d{1,2})?)/);
  if (!m) return null;
  return moneyNumber(m[1]);
}

/** Strip currency symbols so they never become item names / text fields. */
export function stripCurrencyMarks(text: string): string {
  return text
    .replace(/[₱$€£¥₩₹]/g, " ")
    .replace(/\b(?:php|phd|usd|us\$)\b/gi, " ")
    .replace(/\bP(?=\s*[\d,])/g, " ") // P138 → 138
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanItemName(raw: string): string {
  let name = stripCurrencyMarks(raw);
  name = name.replace(CURRENCY_PREFIX_RE, "").replace(CURRENCY_SUFFIX_RE, "");
  name = name.replace(CURRENCY_TOKEN_RE, " ");
  name = name.replace(/^[\d.]+\s+/, "");
  name = name.replace(/[.\-–—:]+$/g, "").trim();
  name = name.replace(/\s+/g, " ").trim();
  return name.slice(0, 120);
}

function normalizeLine(line: string): string {
  return line
    .replace(/\t+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/(\d),(\d{2})\b/g, "$1.$2") // 240,00 → 240.00
    .replace(/[₱$€£¥₩₹]/g, " ") // keep amounts, drop symbols
    .replace(/\b(?:php|phd|usd)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isSkipLine(line: string): boolean {
  if (!line || line.length < 2) return true;
  if (/^[\-=_]{3,}$/.test(line)) return true;
  if (CURRENCY_ONLY_RE.test(line)) return true;
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
  if (CURRENCY_ONLY_RE.test(line)) return false;
  if (DATE_RE.test(line) && line.length < 30) return false;
  if (!/[a-zA-Z]{3,}/.test(line)) return false;
  // Pure money / currency leftovers are not item names
  if (!/[a-zA-Z]{3,}/.test(stripCurrencyMarks(line))) return false;
  if (line.length > 100) return false;
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

type OcrSub = NonNullable<OcrLineItem["subItems"]>[number];

function pushSubItem(subs: OcrSub[], name: string, amount: number | null) {
  const cleaned = cleanItemName(name.replace(/^[\-–—•*·]+\s*/, ""));
  if (!cleaned || cleaned.length < 2) return;
  if (CURRENCY_ONLY_RE.test(cleaned)) return;

  // Nest size/option under the previous component (Pepsi Black → Regular)
  if (SIZE_OR_OPTION_RE.test(cleaned) && subs.length > 0) {
    const parent = subs[subs.length - 1];
    const nested = parent.subItems ?? [];
    nested.push({ name: cleaned, amount });
    parent.subItems = nested;
    return;
  }

  subs.push({ name: cleaned, amount });
}

function collectFollowingSubItems(
  lines: string[],
  startIndex: number
): { subItems: OcrSub[]; consumedThrough: number } {
  const subItems: OcrSub[] = [];
  let consumedThrough = startIndex;

  for (let k = startIndex + 1; k < lines.length; k++) {
    const next = lines[k].trim();
    if (!next) {
      consumedThrough = k;
      continue;
    }
    if (extractQtyPrice(next)) break;
    if (isSummaryLabel(next) || isSkipLine(next)) break;

    // Next priced parent line (inline "Name 99.00")
    const moneyMatch = [...next.matchAll(/([\d,]+\.\d{2})/g)];
    if (moneyMatch.length > 0) {
      const last = moneyMatch[moneyMatch.length - 1];
      const price = parseMoney(last[1]);
      const namePart = next
        .slice(0, last.index ?? 0)
        .trim()
        .replace(/^[\-–—•*·]+\s*/, "");
      if (
        price != null &&
        price > 0 &&
        namePart.length >= 3 &&
        looksLikeItemName(namePart)
      ) {
        break;
      }
    }

    if (MODIFIER_RE.test(next) || /^[•·]/.test(next)) {
      const cleaned = next.replace(/^[\-–—•*·]+\s*/, "").trim();
      if (!cleaned) {
        consumedThrough = k;
        continue;
      }
      const parts = cleaned
        .split(/[,/|]+/)
        .map((p) => p.trim())
        .filter(Boolean);
      for (const part of parts.length ? parts : [cleaned]) {
        const moneyAtEnd = part.match(/^(.*?)([\d,]+\.\d{2})\s*$/);
        if (moneyAtEnd && moneyAtEnd[1].trim()) {
          pushSubItem(subItems, moneyAtEnd[1].trim(), parseMoney(moneyAtEnd[2]));
        } else {
          pushSubItem(subItems, part, null);
        }
      }
      consumedThrough = k;
      continue;
    }

    // Unpriced component lines under a meal/combo (Chowking-style)
    if (
      moneyMatch.length === 0 &&
      (looksLikeItemName(next) ||
        SIZE_OR_OPTION_RE.test(next) ||
        (next.length <= 100 && /[a-zA-Z]{2,}/.test(next)))
    ) {
      pushSubItem(subItems, next, null);
      consumedThrough = k;
      continue;
    }

    break;
  }

  return { subItems, consumedThrough };
}

/**
 * PH POS pattern:
 *   MATCHA COFFEE LATTE
 *   1 X 225.00    225.00
 *   -TALL, ICE, DINE IN
 */
function extractPosItems(lines: string[]): OcrLineItem[] {
  const items: OcrLineItem[] = [];
  const used = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue;
    const line = lines[i];
    const qty = extractQtyPrice(line);
    if (!qty) continue;

    let name: string | null = null;
    for (let j = i - 1; j >= 0; j--) {
      if (used.has(j)) break;
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

    const { subItems, consumedThrough } = collectFollowingSubItems(lines, i);
    for (let u = i; u <= consumedThrough; u++) used.add(u);

    items.push({
      name: cleanItemName(name),
      quantity: qty.quantity,
      unitPrice: qty.unitPrice,
      totalPrice: qty.totalPrice,
      ...(subItems.length ? { subItems } : {}),
    });
  }

  return items.filter((i) => i.name.length >= 2);
}

/** Fallback: single-line "Item name 99.00" + following component lines */
function extractInlineItems(lines: string[]): OcrLineItem[] {
  const items: OcrLineItem[] = [];
  const used = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue;
    const line = lines[i];
    if (isSkipLine(line) || isSummaryLabel(line) || MODIFIER_RE.test(line)) continue;
    if (extractQtyPrice(line)) continue;
    if (DATE_RE.test(line)) continue;

    const moneyMatch = [...line.matchAll(MONEY_RE)];
    if (moneyMatch.length === 0) continue;
    const last = moneyMatch[moneyMatch.length - 1];
    const price = parseMoney(last[1]);
    if (price === null || price <= 0) continue;

    let name = cleanItemName(
      line.slice(0, last.index ?? 0).trim().replace(/[.\-–—:]+$/, "")
    );
    let quantity = 1;
    const qtyMatch = name.match(/^(\d+(?:\.\d+)?)\s*[x×]\s*(.+)$/i);
    if (qtyMatch) {
      quantity = Number(qtyMatch[1]) || 1;
      name = cleanItemName(qtyMatch[2]);
    }
    if (!name || name.length < 3 || !/[a-zA-Z]{3,}/.test(name)) continue;
    if (isSkipLine(name) || isSummaryLabel(name)) continue;

    const { subItems, consumedThrough } = collectFollowingSubItems(lines, i);
    for (let u = i; u <= consumedThrough; u++) used.add(u);

    items.push({
      name,
      quantity,
      unitPrice: quantity > 1 ? moneyNumber(d(price).div(quantity)) : price,
      totalPrice: price,
      ...(subItems.length ? { subItems } : {}),
    });
  }
  return items;
}

function pickMerchant(lines: string[]): string | null {
  for (const line of lines.slice(0, 8)) {
    if (isSkipLine(line)) continue;
    if (/cafe|coffee|restaurant|kitchen|bistro|pizza|grill|chowking|jollibee|mr\.?\s*wen/i.test(line)) {
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
  const inline = dedupeItems(extractInlineItems(lines));
  // Prefer whichever found more structure (items or nested subs)
  const score = (list: OcrLineItem[]) =>
    list.reduce((s, i) => s + 1 + (i.subItems?.length ?? 0), 0);
  if (score(inline) > score(items)) items = inline;

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

  // Final pass: never keep currency marks in names / empty currency leftovers
  items = items
    .map((i) => ({
      ...i,
      name: cleanItemName(i.name),
      subItems: i.subItems
        ?.map((s) => ({
          ...s,
          name: cleanItemName(s.name),
          subItems: s.subItems?.map((n) => ({
            ...n,
            name: cleanItemName(n.name),
          })),
        }))
        .filter((s) => s.name.length >= 2),
    }))
    .filter((i) => i.name.length >= 2);

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
