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
    guest_email: z.union([z.string().email(), z.literal("")]).optional(),
    guest_name: z.string().min(1).max(100),
    role: z.enum(["admin", "member"]).default("member"),
  }),
  z.object({
    kind: z.literal("username"),
    username: z.string().min(3).max(30),
    role: z.enum(["admin", "member"]).default("member"),
  }),
  z.object({
    kind: z.literal("email"),
    email: z.string().email(),
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
    } else if (parsed.data.kind === "email") {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .eq("email", parsed.data.email.trim().toLowerCase())
        .maybeSingle();
      if (!profile) return fail("User not found", 404);
      userId = profile.id;
    } else {
      guestName = parsed.data.guest_name.trim();
      const email = parsed.data.guest_email?.trim();
      guestEmail = email ? email : null;
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
        invited_by: user.id,
      })
      .select("*")
      .single();

    if (error) return fail(error.message, 400);

    // Adding an existing account → auto-friend with the inviter
    if (userId && userId !== user.id) {
      await supabase.rpc("ensure_accepted_friendship", {
        p_inviter: user.id,
        p_invitee: userId,
      });
    }

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
  role: z.enum(["admin", "member"]).optional(),
  guest_name: z.string().min(1).max(100).optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;
    const { id: groupId } = await params;
    const parsed = patchMemberSchema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    // Only owner/admin can manage members
    const { data: me } = await supabase
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!me || (me.role !== "owner" && me.role !== "admin")) {
      return fail("Only the group owner or admin can manage members", 403);
    }

    const { data: target } = await supabase
      .from("group_members")
      .select("id, role, user_id, guest_name")
      .eq("id", parsed.data.member_id)
      .eq("group_id", groupId)
      .maybeSingle();

    if (!target) return fail("Member not found", 404);
    if (target.role === "owner") {
      return fail("Cannot change the group owner", 400);
    }

    const updates: Record<string, unknown> = {};
    if (parsed.data.role) updates.role = parsed.data.role;
    if (parsed.data.guest_name != null) {
      updates.guest_name = parsed.data.guest_name.trim();
    }

    if (Object.keys(updates).length === 0) {
      return fail("Nothing to update", 400);
    }

    const { data, error } = await supabase
      .from("group_members")
      .update(updates)
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
    const { supabase, user } = auth;
    const { id: groupId } = await params;
    const memberId = new URL(request.url).searchParams.get("member_id");
    if (!memberId) return fail("member_id required");

    const { data: me } = await supabase
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!me || (me.role !== "owner" && me.role !== "admin")) {
      return fail("Only the group owner or admin can remove members", 403);
    }

    const { data: target } = await supabase
      .from("group_members")
      .select("role")
      .eq("id", memberId)
      .eq("group_id", groupId)
      .maybeSingle();

    if (target?.role === "owner") {
      return fail("Cannot remove the group owner", 400);
    }

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
