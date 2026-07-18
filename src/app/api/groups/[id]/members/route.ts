import { z } from "zod";
import { getAuthedClient } from "@/lib/supabase/auth";
import { ok, created, unauthorized, fail, fromZod, serverError } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

const addSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("user"),
    user_id: z.string().uuid(),
    role: z.enum(["admin", "member"]).default("member"),
  }),
  z.object({
    kind: z.literal("guest"),
    guest_email: z.string().email(),
    guest_name: z.string().min(1).max(100),
    role: z.enum(["admin", "member"]).default("member"),
  }),
  z.object({
    kind: z.literal("username"),
    username: z.string().min(3).max(30),
    role: z.enum(["admin", "member"]).default("member"),
  }),
]);

export async function POST(request: Request, { params }: Params) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;
    const { id: groupId } = await params;

    const parsed = addSchema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    let userId: string | null = null;
    let guestEmail: string | null = null;
    let guestName: string | null = null;
    const role = parsed.data.role;

    if (parsed.data.kind === "user") {
      userId = parsed.data.user_id;
    } else if (parsed.data.kind === "username") {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .eq("username", parsed.data.username)
        .maybeSingle();
      if (!profile) return fail("User not found", 404);
      userId = profile.id;
    } else {
      guestEmail = parsed.data.guest_email;
      guestName = parsed.data.guest_name;
    }

    const inviteToken = crypto.randomUUID().replace(/-/g, "");

    const { data: member, error } = await supabase
      .from("group_members")
      .insert({
        group_id: groupId,
        user_id: userId,
        guest_email: guestEmail,
        guest_name: guestName,
        role,
        invite_token: userId ? null : inviteToken,
      })
      .select("*")
      .single();

    if (error) return fail(error.message, 400);

    const { data: group } = await supabase
      .from("groups")
      .select("name")
      .eq("id", groupId)
      .single();

    if (userId) {
      await supabase.from("notifications").insert({
        user_id: userId,
        type: "invitation",
        title: `Joined ${group?.name ?? "a group"}`,
        body: `You were added to ${group?.name ?? "a group"}.`,
        link: `/groups/${groupId}`,
      });
    }

    await supabase.from("activities").insert({
      user_id: user.id,
      group_id: groupId,
      action: "member_added",
      metadata: { userId, guestEmail, guestName },
    });

    return created(member);
  } catch (e) {
    console.error(e);
    return serverError();
  }
}

const patchMemberSchema = z.object({
  member_id: z.string().uuid(),
  role: z.enum(["owner", "admin", "member"]).optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase } = auth;
    const { id: groupId } = await params;
    const parsed = patchMemberSchema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    const { data, error } = await supabase
      .from("group_members")
      .update({ role: parsed.data.role })
      .eq("id", parsed.data.member_id)
      .eq("group_id", groupId)
      .select("*")
      .single();

    if (error) return fail(error.message, 400);
    return ok(data);
  } catch (e) {
    console.error(e);
    return serverError();
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase } = auth;
    const { id: groupId } = await params;
    const memberId = new URL(request.url).searchParams.get("member_id");
    if (!memberId) return fail("member_id required");

    const { error } = await supabase
      .from("group_members")
      .delete()
      .eq("id", memberId)
      .eq("group_id", groupId);

    if (error) return fail(error.message, 400);
    return ok({ deleted: true });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
