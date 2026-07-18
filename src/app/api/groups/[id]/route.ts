import { z } from "zod";
import { getAuthedClient } from "@/lib/supabase/auth";
import {
  ok,
  unauthorized,
  notFound,
  fail,
  fromZod,
  serverError,
} from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;
    const { id } = await params;

    const { data: group, error } = await supabase
      .from("groups")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) return fail(error.message, 400);
    if (!group) return notFound("Group not found");

    const { data: members } = await supabase
      .from("group_members")
      .select(
        "id, role, user_id, guest_email, guest_name, invite_token, claimed_at, joined_at, profiles:user_id(id, full_name, username, avatar_url, email)"
      )
      .eq("group_id", id)
      .order("joined_at", { ascending: true });

    const my = (members ?? []).find((m) => m.user_id === user.id);

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

    return ok({
      group,
      members: members ?? [],
      my_role: my?.role ?? null,
      invite_url: `${appUrl}/invite/${group.invite_code}`,
    });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  photo_url: z.string().url().nullable().optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase } = auth;
    const { id } = await params;
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    const { data, error } = await supabase
      .from("groups")
      .update(parsed.data)
      .eq("id", id)
      .select("*")
      .single();

    if (error) return fail(error.message, 400);
    return ok(data);
  } catch (e) {
    console.error(e);
    return serverError();
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase } = auth;
    const { id } = await params;

    const { error } = await supabase.from("groups").delete().eq("id", id);
    if (error) return fail(error.message, 400);
    return ok({ deleted: true });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
