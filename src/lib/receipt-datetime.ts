/** Safe parsers for OCR date/time → Postgres-friendly values. */

export function tryReceiptDate(raw: string): string | null {
  const cleaned = raw.trim();
  const m = cleaned.match(/(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})/);
  if (!m) return null;

  let y: string;
  let mo: string;
  let d: string;

  if (m[1].length === 4) {
    y = m[1];
    mo = m[2].padStart(2, "0");
    d = m[3].padStart(2, "0");
  } else if (m[3].length === 4) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    // Prefer D/M/Y (PH). If first part > 12 it must be day; if second > 12 it must be US M/D.
    if (a > 12 && b <= 12) {
      d = m[1].padStart(2, "0");
      mo = m[2].padStart(2, "0");
    } else if (b > 12 && a <= 12) {
      mo = m[1].padStart(2, "0");
      d = m[2].padStart(2, "0");
    } else {
      // Ambiguous — assume D/M/Y (common in PH)
      d = m[1].padStart(2, "0");
      mo = m[2].padStart(2, "0");
    }
    y = m[3];
    if (y.length === 2) y = `20${y}`;
  } else {
    return null;
  }

  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const iso = `${y}-${mo}-${d}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  // Reject Date() overflow (e.g. Feb 31 → Mar 3)
  if (dt.getUTCMonth() + 1 !== month || dt.getUTCDate() !== day) return null;
  return iso;
}

export function tryReceiptTime(raw: string): string | null {
  const m = raw.trim().match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!m) return null;

  let h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3] ?? "0");
  const ap = m[4]?.toUpperCase();

  if (Number.isNaN(h) || Number.isNaN(min) || min > 59 || sec > 59) return null;

  if (ap === "PM" && h >= 1 && h < 12) h += 12;
  else if (ap === "AM" && h === 12) h = 0;
  else if (ap && (h < 1 || h > 12)) return null;

  if (h < 0 || h > 23) return null;

  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
