import { getAuthedClient } from "@/lib/supabase/auth";
import { ok, unauthorized, serverError, fail } from "@/lib/api";

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

    let query = supabase
      .from("receipts")
      .select(
        "id, merchant, total, currency, status, receipt_date, ocr_confidence, created_at, updated_at",
        { count: "exact" }
      )
      .eq("created_by", user.id)
      .order("created_at", { ascending: false })
      .range(from, to);

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
