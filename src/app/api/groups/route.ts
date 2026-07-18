import { z } from "zod";
import { getAuthedClient } from "@/lib/supabase/auth";
import { ok, created, unauthorized, fail, fromZod, serverError } from "@/lib/api";

export async function GET() {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;

    const { data: memberships, error } = await supabase
      .from("group_members")
      .select("role, group_id, groups(id, name, description, photo_url, invite_code, created_by, created_at)")
      .eq("user_id", user.id);

    if (error) return fail(error.message, 400);

    const groups = (memberships ?? [])
      .map((m) => {
        const g = m.groups as unknown as Record<string, unknown> | Record<string, unknown>[] | null;
        const group = Array.isArray(g) ? g[0] : g;
        if (!group) return null;
        return { ...group, my_role: m.role };
      })
      .filter(Boolean);

    return ok(groups);
  } catch (e) {
    console.error(e);
    return serverError();
  }
}

const createSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;

    const body = await request.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return fromZod(parsed.error);

    const inviteCode = crypto.randomUUID().replace(/-/g, "").slice(0, 12);

    const { data: group, error } = await supabase
      .from("groups")
      .insert({
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        created_by: user.id,
        invite_code: inviteCode,
      })
      .select("*")
      .single();

    if (error) return fail(error.message, 400);

    const { error: memberError } = await supabase.from("group_members").insert({
      group_id: group.id,
      user_id: user.id,
      role: "owner",
    });

    if (memberError) return fail(memberError.message, 400);

    await supabase.from("activities").insert({
      user_id: user.id,
      group_id: group.id,
      action: "group_created",
      metadata: { name: group.name },
    });

    return created({ ...group, my_role: "owner" });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
