import { z } from "zod";
import { getAuthedClient } from "@/lib/supabase/auth";
import { ok, created, unauthorized, serverError, fail, fromZod } from "@/lib/api";
import { computeReceiptTotals } from "@/lib/money";

export async function GET(request: Request) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(50, Math.max(1, Number(searchParams.get("pageSize") ?? 20)));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const q = searchParams.get("q")?.trim();
    const excludeGroup = searchParams.get("excludeGroup")?.trim();

    let query = supabase
      .from("receipts")
      .select(
        "id, merchant, total, currency, status, receipt_date, ocr_confidence, created_at, updated_at, group_id",
        { count: "exact" }
      )
      .eq("created_by", user.id)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (excludeGroup) {
      query = query.or(`group_id.is.null,group_id.neq.${excludeGroup}`);
    }

    if (q) {
      query = query.ilike("merchant", `%${q}%`);
    }

    const { data, error, count } = await query;
    if (error) return fail(error.message, 400);

    return ok(data ?? [], undefined, {
      page,
      pageSize,
      total: count ?? 0,
    });
  } catch (error) {
    console.error(error);
    return serverError();
  }
}

const manualItemSchema = z.object({
  name: z.string().min(1).max(200),
  quantity: z.number().positive().default(1),
  unit_price: z.number().min(0).default(0),
  total_price: z.number().min(0).optional(),
});

const createSchema = z.object({
  merchant: z.string().max(200).optional().nullable(),
  group_id: z.string().uuid().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  currency: z.string().length(3).optional(),
  items: z.array(manualItemSchema).optional(),
});

/** Create a blank / manual receipt (no OCR upload). */
export async function POST(request: Request) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;

    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    const groupId = parsed.data.group_id ?? null;
    if (groupId) {
      const { data: group } = await supabase
        .from("groups")
        .select("id, created_by")
        .eq("id", groupId)
        .maybeSingle();
      if (!group) return fail("Group not found", 404);
      if (group.created_by !== user.id) {
        return fail("Only the group creator can add receipts to this group", 403);
      }
    }

    const { data: settings } = await supabase
      .from("user_settings")
      .select("currency")
      .eq("user_id", user.id)
      .maybeSingle();

    const currency = parsed.data.currency ?? settings?.currency ?? "PHP";
    const items = (parsed.data.items ?? []).map((item, index) => {
      const quantity = item.quantity > 0 ? item.quantity : 1;
      const unit_price = item.unit_price >= 0 ? item.unit_price : 0;
      const total_price =
        item.total_price != null ? item.total_price : quantity * unit_price;
      return {
        name: item.name.trim(),
        quantity,
        unit_price,
        total_price,
        sort_order: index,
        split_mode: "among_n" as const,
        split_n: 1,
      };
    });

    const totals = computeReceiptTotals({
      items: items.map((i) => ({
        quantity: i.quantity,
        unitPrice: i.unit_price,
        totalPrice: i.total_price,
      })),
      tax: 0,
      discount: 0,
      serviceCharge: 0,
      tip: 0,
    });

    const receiptId = crypto.randomUUID();
    const { error: receiptError } = await supabase.from("receipts").insert({
      id: receiptId,
      created_by: user.id,
      group_id: groupId,
      currency,
      status: items.length > 0 ? "edited" : "draft",
      merchant: parsed.data.merchant?.trim() || null,
      notes: parsed.data.notes?.trim() || null,
      subtotal: totals.itemsSubtotal,
      tax: 0,
      discount: 0,
      service_charge: 0,
      tip: 0,
      total: totals.total,
    });

    if (receiptError) return fail(receiptError.message, 400);

    if (items.length > 0) {
      const { error: itemsError } = await supabase.from("receipt_items").insert(
        items.map((item) => ({
          receipt_id: receiptId,
          name: item.name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total_price: item.total_price,
          sort_order: item.sort_order,
          split_mode: item.split_mode,
          split_n: item.split_n,
        }))
      );
      if (itemsError) {
        if (/split_mode|split_n|column/i.test(itemsError.message)) {
          const { error: fallbackErr } = await supabase.from("receipt_items").insert(
            items.map((item) => ({
              receipt_id: receiptId,
              name: item.name,
              quantity: item.quantity,
              unit_price: item.unit_price,
              total_price: item.total_price,
              sort_order: item.sort_order,
            }))
          );
          if (fallbackErr) return fail(fallbackErr.message, 400);
        } else {
          return fail(itemsError.message, 400);
        }
      }
    }

    await supabase.from("receipt_history").insert({
      receipt_id: receiptId,
      user_id: user.id,
      event: "created_manual",
      metadata: { item_count: items.length, group_id: groupId },
    });

    await supabase.from("activities").insert({
      user_id: user.id,
      group_id: groupId,
      action: "receipt_created",
      metadata: { receipt_id: receiptId, manual: true },
    });

    return created({ id: receiptId, group_id: groupId });
  } catch (error) {
    console.error(error);
    return serverError();
  }
}
