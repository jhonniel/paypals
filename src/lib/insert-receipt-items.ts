import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeSubItems } from "@/lib/receipt-sub-items";

type InsertItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  subItems?: Array<{ name: string; amount?: number | null }> | null;
};

/** Insert OCR/manual line items, including sub_items when the column exists. */
export async function insertReceiptItems(
  supabase: SupabaseClient,
  receiptId: string,
  items: InsertItem[]
): Promise<{ error: string | null }> {
  if (!items.length) return { error: null };

  const withSubs = items.map((item, index) => ({
    receipt_id: receiptId,
    name: item.name.slice(0, 200),
    quantity: item.quantity,
    unit_price: item.unitPrice,
    total_price: item.totalPrice,
    sort_order: index,
    sub_items: normalizeSubItems(item.subItems ?? []),
  }));

  const first = await supabase.from("receipt_items").insert(withSubs);
  if (!first.error) return { error: null };

  if (/sub_items|column/i.test(first.error.message)) {
    const { error } = await supabase.from("receipt_items").insert(
      items.map((item, index) => ({
        receipt_id: receiptId,
        name: item.name.slice(0, 200),
        quantity: item.quantity,
        unit_price: item.unitPrice,
        total_price: item.totalPrice,
        sort_order: index,
      }))
    );
    return { error: error?.message ?? null };
  }

  return { error: first.error.message };
}
