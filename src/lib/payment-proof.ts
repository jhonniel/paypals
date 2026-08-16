import { moneyNumber, d } from "@/lib/money";
import { tryReceiptDate } from "@/lib/receipt-datetime";

/** Payment proof “today” is always Philippine time. */
export const PAYMENT_PROOF_TIMEZONE = "Asia/Manila";

export type PaymentProofParse = {
  amount: number | null;
  date: string | null; // YYYY-MM-DD
  transactionNumber: string | null;
  rawHints: string[];
};

const TXN_LABEL_RE =
  /(?:ref(?:\.|\s)?(?:no|number|#)?|reference(?:\s*(?:no|number|#))?|transaction(?:\s*(?:id|no|number|#))?|txn(?:\s*(?:id|no|number|#))?)\s*[:\-#]?\s*([A-Z0-9][A-Z0-9\-]{5,39})/gi;

const AMOUNT_LABEL_RE =
  /(?:amount|total|you\s+sent|sent|transfer(?:red)?|paid|payment|bayad)\s*[:\-]?\s*(?:php|₱)?\s*([\d,]+(?:\.\d{1,2})?)/i;

const PHP_AMOUNT_RE =
  /(?:php|₱)\s*([\d,]+(?:\.\d{1,2})?)/gi;

const PLAIN_MONEY_RE = /\b(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})\b/g;

const DATE_LABEL_RE =
  /(?:date|when|on|timestamp|time)\s*[:\-]?\s*([^\n]{6,40})/i;

const MONTHS: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

function parseMoneyToken(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) return null;
  const n = moneyNumber(cleaned);
  return n > 0 ? n : null;
}

function pickBestAmount(candidates: number[]): number | null {
  if (!candidates.length) return null;
  const scored = [...new Set(candidates.map((n) => moneyNumber(n)))]
    .filter((n) => n >= 1 && n <= 500_000)
    .sort((a, b) => b - a);
  return scored[0] ?? null;
}

function parseMonthNameDate(raw: string): string | null {
  const mdy = raw.match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})\b/i
  );
  if (mdy) {
    const mo = MONTHS[mdy[1].toLowerCase()];
    const day = mdy[2].padStart(2, "0");
    if (mo) return `${mdy[3]}-${mo}-${day}`;
  }
  const dmy = raw.match(
    /\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})\b/i
  );
  if (dmy) {
    const mo = MONTHS[dmy[2].toLowerCase()];
    const day = dmy[1].padStart(2, "0");
    if (mo) return `${dmy[3]}-${mo}-${day}`;
  }
  return null;
}

function extractDates(text: string): string[] {
  const found: string[] = [];
  const label = text.match(DATE_LABEL_RE);
  if (label?.[1]) {
    const iso = tryReceiptDate(label[1]) ?? parseMonthNameDate(label[1]);
    if (iso) found.push(iso);
  }
  const loose =
    text.match(
      /\b(\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\b/g
    ) ?? [];
  for (const raw of loose) {
    const iso = tryReceiptDate(raw);
    if (iso) found.push(iso);
  }
  const named = parseMonthNameDate(text);
  if (named) found.push(named);
  return [...new Set(found)];
}

/** Parse GCash / Maya / bank transfer screenshot OCR text. */
export function parsePaymentProofText(raw: string): PaymentProofParse {
  const text = raw.replace(/\u00a0/g, " ");
  const hints: string[] = [];
  const amounts: number[] = [];

  const labeled = text.match(AMOUNT_LABEL_RE);
  if (labeled?.[1]) {
    const n = parseMoneyToken(labeled[1]);
    if (n != null) {
      amounts.push(n);
      hints.push(`labeled:${n}`);
    }
  }

  for (const m of text.matchAll(PHP_AMOUNT_RE)) {
    const n = parseMoneyToken(m[1]);
    if (n != null) {
      amounts.push(n);
      hints.push(`php:${n}`);
    }
  }

  if (!amounts.length) {
    for (const m of text.matchAll(PLAIN_MONEY_RE)) {
      const n = parseMoneyToken(m[1]);
      if (n != null) amounts.push(n);
    }
  }

  const dates = extractDates(text);
  if (dates[0]) hints.push(`date:${dates[0]}`);

  let transactionNumber: string | null = null;
  for (const m of text.matchAll(TXN_LABEL_RE)) {
    const candidate = m[1]?.trim().toUpperCase();
    if (candidate && candidate.length >= 6) {
      transactionNumber = candidate;
      hints.push(`txn:${candidate}`);
      break;
    }
  }

  return {
    amount: pickBestAmount(amounts),
    date: dates[0] ?? null,
    transactionNumber,
    rawHints: hints,
  };
}

/** Calendar date in Asia/Manila (YYYY-MM-DD). */
export function todayInManila(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PAYMENT_PROOF_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function todayInTimezone(timeZone = PAYMENT_PROOF_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Amounts match within ₱1.00 (OCR rounding / fees noise). */
export function amountsMatch(
  expected: number,
  actual: number,
  tolerance = 1
): boolean {
  return d(expected).sub(actual).abs().lte(tolerance);
}
