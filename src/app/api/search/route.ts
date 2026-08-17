import { getAuthedClient } from "@/lib/supabase/auth";
import { ok, unauthorized, serverError, fail } from "@/lib/api";

export type SearchPersonHit = {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  email: string | null;
  is_guest?: boolean;
  guest_name?: string | null;
};

export async function GET(request: Request) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;

    const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) {
      return ok({ receipts: [], groups: [], people: [] as SearchPersonHit[] });
    }

    const pattern = `%${q.replace(/[%_,]/g, "")}%`;
    const peopleFilter = `full_name.ilike."${pattern}",username.ilike."${pattern}",email.ilike."${pattern}"`;

    const [receipts, memberships, profiles, myMemberships] = await Promise.all([
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
      supabase.from("group_members").select("group_id").eq("user_id", user.id),
    ]);

    if (receipts.error) return fail(receipts.error.message, 400);
    if (profiles.error) return fail(profiles.error.message, 400);

    const groupIds = [
      ...new Set((myMemberships.data ?? []).map((m) => m.group_id)),
    ];

    let guestHits: SearchPersonHit[] = [];
    if (groupIds.length) {
      const guestFilter = `guest_name.ilike."${pattern}",guest_email.ilike."${pattern}"`;
      const { data: guestMembers, error: guestError } = await supabase
        .from("group_members")
        .select("id, guest_name, guest_email, user_id")
        .in("group_id", groupIds)
        .is("user_id", null)
        .not("guest_name", "is", null)
        .or(guestFilter)
        .limit(24);

      if (guestError) return fail(guestError.message, 400);

      const seenGuestNames = new Set<string>();
      for (const g of guestMembers ?? []) {
        const guestName = String(g.guest_name ?? "").trim();
        if (!guestName) continue;
        const key = guestName.toLowerCase();
        if (seenGuestNames.has(key)) continue;
        seenGuestNames.add(key);
        guestHits.push({
          id: `guest:${g.id}`,
          full_name: guestName,
          username: null,
          avatar_url: null,
          email: g.guest_email,
          is_guest: true,
          guest_name: guestName,
        });
      }
    }

    const profilePeople: SearchPersonHit[] = (profiles.data ?? []).map((p) => ({
      id: p.id,
      full_name: p.full_name,
      username: p.username,
      avatar_url: p.avatar_url,
      email: p.email,
    }));

    const people = [...profilePeople, ...guestHits].slice(0, 12);

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
      people,
    });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
