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
  await supabase.from("receipt_discounts").delete().eq("receipt_id", receiptId);

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

  if (error && /receipt_discounts|relation|column/i.test(error.message)) {
    return { error: null };
  }

  return { error: error?.message ?? null };
}
