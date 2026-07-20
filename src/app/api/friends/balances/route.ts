import { getAuthedClient } from "@/lib/supabase/auth";
import { ok, unauthorized, fail, serverError } from "@/lib/api";
import { computeFriendUnpaidBalances } from "@/lib/friend-unpaid-balances";

export async function GET() {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;

    const { data: friendships, error } = await supabase
      .from("friends")
      .select(
        "id, status, requester_id, addressee_id, requester:requester_id(id, full_name, username, avatar_url), addressee:addressee_id(id, full_name, username, avatar_url)"
      )
      .eq("status", "accepted")
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);

    if (error) return fail(error.message, 400);

    const accepted = friendships ?? [];
    const friendUserIds = accepted.map((f) =>
      f.requester_id === user.id ? f.addressee_id : f.requester_id
    );

    const balances = await computeFriendUnpaidBalances(
      supabase,
      user.id,
      friendUserIds
    );

    const rows = accepted.map((f) => {
      const friendId =
        f.requester_id === user.id ? f.addressee_id : f.requester_id;
      const profile =
        f.requester_id === user.id ? f.addressee : f.requester;
      const p = Array.isArray(profile) ? profile[0] : profile;
      const balance = balances.get(friendId);

      return {
        friendship_id: f.id,
        user_id: friendId,
        full_name: (p as { full_name?: string | null } | null)?.full_name ?? null,
        username: (p as { username?: string | null } | null)?.username ?? null,
        avatar_url:
          (p as { avatar_url?: string | null } | null)?.avatar_url ?? null,
        total_unpaid: balance?.total_unpaid ?? 0,
        currency: balance?.currency ?? "PHP",
        in_owned_group: balance?.in_owned_group ?? false,
        groups: balance?.groups ?? [],
      };
    });

    return ok(rows);
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
