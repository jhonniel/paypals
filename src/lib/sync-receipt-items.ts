import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeSubItems } from "@/lib/receipt-sub-items";

export type SyncReceiptItemInput = {
  id?: string;
  name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  sort_order?: number;
  split_mode?: "among_claimers" | "among_group" | "among_n";
  split_n?: number | null;
  sub_items?: unknown;
};

type ExistingItem = {
  id: string;
  split_mode: string | null;
};

function buildItemRow(
  receiptId: string,
  item: SyncReceiptItemInput,
  index: number,
  includeSubItems: boolean
) {
  const mode = item.split_mode ?? "among_n";
  const splitN =
    mode === "among_n" ? Math.max(1, item.split_n ?? 1) : null;

  const row: Record<string, unknown> = {
    receipt_id: receiptId,
    name: item.name,
    quantity: item.quantity,
    unit_price: item.unit_price,
    total_price: item.total_price,
    sort_order: item.sort_order ?? index,
    split_mode: mode,
    split_n: mode === "among_n" ? splitN : null,
  };

  if (includeSubItems) {
    row.sub_items = normalizeSubItems(item.sub_items ?? []);
  }

  return row;
}

/**
 * Upsert receipt line items without wiping member picks on unchanged rows.
 * Returns item ids that need fresh among_group auto-assignment.
 */
export async function syncReceiptItems(
  supabase: SupabaseClient,
  receiptId: string,
  items: SyncReceiptItemInput[]
): Promise<{ error: string | null; amongGroupItemIds: string[] }> {
  const { data: existingRows, error: existingError } = await supabase
    .from("receipt_items")
    .select("id, split_mode")
    .eq("receipt_id", receiptId);

  if (existingError) return { error: existingError.message, amongGroupItemIds: [] };

  const existingById = new Map<string, ExistingItem>(
    (existingRows ?? []).map((row) => [row.id, row as ExistingItem])
  );
  const payloadIds = new Set(
    items.map((item) => item.id).filter((id): id is string => Boolean(id))
  );

  const staleIds = [...existingById.keys()].filter((id) => !payloadIds.has(id));
  if (staleIds.length) {
    const { error: deleteError } = await supabase
      .from("receipt_items")
      .delete()
      .in("id", staleIds);
    if (deleteError) return { error: deleteError.message, amongGroupItemIds: [] };
  }

  const amongGroupItemIds: string[] = [];

  for (let index = 0; index < items.length; index++) {
    const item = items[index]!;
    const mode = item.split_mode ?? "among_n";
    const rowWithSubs = buildItemRow(receiptId, item, index, true);
    const rowWithoutSubs = buildItemRow(receiptId, item, index, false);

    if (item.id && existingById.has(item.id)) {
      let { error: updateError } = await supabase
        .from("receipt_items")
        .update(rowWithSubs)
        .eq("id", item.id)
        .eq("receipt_id", receiptId);

      if (updateError && /sub_items|column/i.test(updateError.message)) {
        ({ error: updateError } = await supabase
          .from("receipt_items")
          .update(rowWithoutSubs)
          .eq("id", item.id)
          .eq("receipt_id", receiptId));
      }

      if (updateError && /split_mode|split_n|column/i.test(updateError.message)) {
        const { split_mode: _sm, split_n: _sn, ...legacyRow } = rowWithoutSubs;
        ({ error: updateError } = await supabase
          .from("receipt_items")
          .update(legacyRow)
          .eq("id", item.id)
          .eq("receipt_id", receiptId));
      }

      if (updateError) return { error: updateError.message, amongGroupItemIds: [] };

      const previousMode = existingById.get(item.id)?.split_mode ?? "among_n";
      if (mode === "among_group" && previousMode !== "among_group") {
        amongGroupItemIds.push(item.id);
      }
      continue;
    }

    let { data: inserted, error: insertError } = await supabase
      .from("receipt_items")
      .insert(rowWithSubs)
      .select("id")
      .single();

    if (insertError && /sub_items|column/i.test(insertError.message)) {
      ({ data: inserted, error: insertError } = await supabase
        .from("receipt_items")
        .insert(rowWithoutSubs)
        .select("id")
        .single());
    }

    if (insertError && /split_mode|split_n|column/i.test(insertError.message)) {
      const { split_mode: _sm, split_n: _sn, ...legacyRow } = rowWithoutSubs;
      ({ data: inserted, error: insertError } = await supabase
        .from("receipt_items")
        .insert(legacyRow)
        .select("id")
        .single());
    }

    if (insertError) return { error: insertError.message, amongGroupItemIds: [] };

    if (mode === "among_group" && inserted?.id) {
      amongGroupItemIds.push(inserted.id);
    }
  }

  return { error: null, amongGroupItemIds };
}
