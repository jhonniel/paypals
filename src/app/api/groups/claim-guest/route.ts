import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedClient } from "@/lib/supabase/auth";
import { ok, unauthorized, fail, fromZod, serverError, notFound } from "@/lib/api";

const schema = z.object({
  token: z.string().min(8).max(64),
});

/** Preview guest invite by token. */
export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token")?.trim() ?? "";
    if (token.length < 8) return fail("Invalid invite");

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_guest_invite", {
      p_token: token,
    });

    if (error) return fail(error.message, 400);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || row.claimed) return notFound("Invite not found or already claimed");

    return ok({
      memberId: row.member_id,
      guestName: row.guest_name,
      group: {
        id: row.group_id,
        name: row.group_name,
        description: row.group_description,
      },
    });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}

/** Claim guest seat after signup / login. */
export async function POST(request: Request) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    const { data: memberId, error } = await auth.supabase.rpc("claim_guest_invite", {
      p_token: parsed.data.token,
    });

    if (error) return fail(error.message, 400);

    const { data: member } = await auth.supabase
      .from("group_members")
      .select("group_id, invited_by")
      .eq("id", memberId)
      .maybeSingle();

    if (member?.group_id) {
      const { data: group } = await auth.supabase
        .from("groups")
        .select("name")
        .eq("id", member.group_id)
        .maybeSingle();

      let body = `You were added to ${group?.name ?? "a group"}.`;
      if (member.invited_by) {
        const { data: inviter } = await auth.supabase
          .from("profiles")
          .select("full_name, username")
          .eq("id", member.invited_by)
          .maybeSingle();
        const inviterName =
          inviter?.full_name?.trim() ||
          (inviter?.username ? `@${inviter.username}` : null);
        if (inviterName) {
          body = `${inviterName} added you to ${group?.name ?? "a group"}.`;
        }
      }

      await auth.supabase.from("notifications").insert({
        user_id: auth.user.id,
        type: "invitation",
        title: `Added to ${group?.name ?? "a group"}`,
        body,
        link: `/groups/${member.group_id}`,
      });
    }

    await auth.supabase
      .from("profiles")
      .update({ invite_verified: true })
      .eq("id", auth.user.id);

    return ok({
      member_id: memberId,
      group_id: member?.group_id ?? null,
    });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
