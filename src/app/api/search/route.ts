import { getAuthedClient } from "@/lib/supabase/auth";
import { ok, unauthorized, serverError, fail } from "@/lib/api";

export async function GET(request: Request) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;

    const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) {
      return ok({ receipts: [], groups: [], people: [] });
    }

    const pattern = `%${q.replace(/[%_,]/g, "")}%`;
    const peopleFilter = `full_name.ilike."${pattern}",username.ilike."${pattern}"`;

    const [receipts, memberships, profiles] = await Promise.all([
      supabase
        .from("receipts")
        .select("id, merchant, total, created_at, status")
        .eq("created_by", user.id)
        .ilike("merchant", pattern)
        .limit(8),
      supabase
        .from("group_members")
        .select("group_id, groups(id, name, description)")
        .eq("user_id", user.id),
      supabase
        .from("profiles")
        .select("id, full_name, username, avatar_url, email")
        .or(peopleFilter)
        .neq("id", user.id)
        .limit(12),
    ]);

    if (receipts.error) return fail(receipts.error.message, 400);

    const groups = (memberships.data ?? [])
      .map((m) => {
        const g = m.groups as unknown as
          | { id: string; name: string; description: string | null }
          | { id: string; name: string; description: string | null }[]
          | null;
        return Array.isArray(g) ? g[0] : g;
      })
      .filter((g): g is { id: string; name: string; description: string | null } =>
        Boolean(g && g.name.toLowerCase().includes(q.toLowerCase()))
      )
      .slice(0, 8);

    return ok({
      receipts: receipts.data ?? [],
      groups,
      people: profiles.data ?? [],
    });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
