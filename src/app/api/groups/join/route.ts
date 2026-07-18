import { z } from "zod";
import { getAuthedClient } from "@/lib/supabase/auth";
import { ok, unauthorized, fail, fromZod, serverError, notFound } from "@/lib/api";

const joinSchema = z.object({
  code: z.string().min(4).max(64),
});

/** Preview group by invite code */
export async function GET(request: Request) {
  try {
    const auth = await getAuthedClient();
    const code = new URL(request.url).searchParams.get("code");
    if (!code) return fail("code required");

    // Use RPC (works even before membership)
    const client = auth?.supabase;
    if (!client) {
      // anonymous preview via createClient pattern — require auth for now
      return unauthorized("Sign in to view invites");
    }

    const { data, error } = await client.rpc("get_group_by_invite", {
      p_code: code,
    });

    if (error) return fail(error.message, 400);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return notFound("Invite not found");

    return ok(row);
  } catch (e) {
    console.error(e);
    return serverError();
  }
}

/** Join group by invite code */
export async function POST(request: Request) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;

    const parsed = joinSchema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    const { data: groupId, error } = await supabase.rpc("join_group_by_invite", {
      p_code: parsed.data.code,
    });

    if (error) return fail(error.message, 400);

    const { data: group } = await supabase
      .from("groups")
      .select("id, name, created_by")
      .eq("id", groupId)
      .single();

    if (group?.created_by) {
      await supabase.from("notifications").insert({
        user_id: group.created_by,
        type: "member_joined",
        title: "New member joined",
        body: `Someone joined ${group.name}.`,
        link: `/groups/${group.id}`,
      });
    }

    await supabase.from("notifications").insert({
      user_id: user.id,
      type: "invitation",
      title: `Welcome to ${group?.name ?? "the group"}`,
      body: "You joined via invite link.",
      link: `/groups/${groupId}`,
    });

    return ok({ group_id: groupId });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
