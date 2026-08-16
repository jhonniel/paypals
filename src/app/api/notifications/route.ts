import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ok, unauthorized, serverError, fromZod, fail } from "@/lib/api";

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return unauthorized();

    const { searchParams } = new URL(request.url);
    const unreadOnly = searchParams.get("unread") === "true";
    const limit = Math.min(Number(searchParams.get("limit") ?? 20), 50);

    let query = supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (unreadOnly) query = query.is("read_at", null);

    const { data, error } = await query;
    if (error) throw error;

    const { count: unreadCount, error: countError } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null);

    if (countError) throw countError;

    return ok(data ?? [], undefined, { unread_count: unreadCount ?? 0 });
  } catch (error) {
    console.error(error);
    return serverError();
  }
}

const patchSchema = z.object({
  ids: z.array(z.string().uuid()).optional(),
  all: z.boolean().optional(),
  link: z.string().min(1).optional(),
});

/** Mark notifications as read */
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return unauthorized();

    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    let query = supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("read_at", null);

    if (parsed.data.ids?.length) {
      query = query.in("id", parsed.data.ids);
    } else if (parsed.data.link) {
      query = query.eq("link", parsed.data.link);
    } else if (parsed.data.all) {
      /* mark all unread */
    } else {
      return fail("Provide ids, link, or all: true");
    }

    const { error } = await query;
    if (error) return fail(error.message, 400);
    return ok({ updated: true });
  } catch (error) {
    console.error(error);
    return serverError();
  }
}
