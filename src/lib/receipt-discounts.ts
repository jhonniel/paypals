import type { SupabaseClient } from "@supabase/supabase-js";
import { moneyNumber } from "@/lib/money";

export type ReceiptDiscountRow = {
  id?: string;
  label: string;
  amount: number;
  sort_order?: number;
};

export function sumDiscountAmount(rows: Array<{ amount: number }>): number {
  return moneyNumber(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
}

/** True when receipt_discounts table/embed is missing or not yet in PostgREST schema cache. */
export function isReceiptDiscountsUnavailable(
  error: { message: string } | null | undefined
): boolean {
  if (!error) return false;
  return /receipt_discounts|relationship|schema cache|does not exist|column/i.test(
    error.message
  );
}

export async function fetchReceiptDiscountsByReceiptIds(
  supabase: SupabaseClient,
  receiptIds: string[]
): Promise<Map<string, ReceiptDiscountRow[]>> {
  const map = new Map<string, ReceiptDiscountRow[]>();
  if (!receiptIds.length) return map;

  const { data, error } = await supabase
    .from("receipt_discounts")
    .select("id, receipt_id, label, amount, sort_order")
    .in("receipt_id", receiptIds)
    .order("sort_order", { ascending: true });

  if (error) {
    if (!isReceiptDiscountsUnavailable(error)) {
      console.warn("fetchReceiptDiscountsByReceiptIds", error.message);
    }
    return map;
  }

  for (const row of data ?? []) {
    const receiptId = row.receipt_id as string;
    const list = map.get(receiptId) ?? [];
    list.push({
      id: row.id as string,
      label: row.label as string,
      amount: Number(row.amount),
      sort_order: row.sort_order as number,
    });
    map.set(receiptId, list);
  }

  return map;
}

/** Prefer stored rows; fall back to legacy single receipts.discount total. */
export function normalizeDiscountRows(
  rows: ReceiptDiscountRow[] | undefined | null,
  legacyTotal?: number
): ReceiptDiscountRow[] {
  if (rows?.length) {
    return rows
      .map((row, index) => ({
        id: row.id,
        label: (row.label?.trim() || "Discount").slice(0, 100),
        amount: moneyNumber(row.amount),
        sort_order: row.sort_order ?? index,
      }))
      .filter((row) => row.amount > 0);
  }
  if (legacyTotal != null && Number(legacyTotal) > 0) {
    return [{ label: "Discount", amount: moneyNumber(legacyTotal) }];
  }
  return [];
}

export async function insertReceiptDiscounts(
  supabase: SupabaseClient,
  receiptId: string,
  discounts: ReceiptDiscountRow[]
): Promise<{ error: string | null }> {
  const del = await supabase.from("receipt_discounts").delete().eq("receipt_id", receiptId);
  if (del.error) {
    if (isReceiptDiscountsUnavailable(del.error)) {
      return { error: null };
    }
    return { error: del.error.message };
  }

  const rows = normalizeDiscountRows(discounts);
  if (!rows.length) return { error: null };

  const { error } = await supabase.from("receipt_discounts").insert(
    rows.map((row, index) => ({
      receipt_id: receiptId,
      label: row.label,
      amount: row.amount,
      sort_order: row.sort_order ?? index,
    }))
  );

  if (error && isReceiptDiscountsUnavailable(error)) {
    return { error: null };
  }

  return { error: error?.message ?? null };
}
