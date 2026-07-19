import { z } from "zod";
import { getAdminClient, writeAuditLog } from "@/lib/supabase/auth";
import { ok, forbidden, fail, fromZod, serverError, created } from "@/lib/api";

export async function GET() {
  try {
    const auth = await getAdminClient();
    if (!auth) return forbidden("Admin access required");

    const { data, error } = await auth.supabase
      .from("signup_invites")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) return fail(error.message, 400);
    return ok(data ?? []);
  } catch (e) {
    console.error(e);
    return serverError();
  }
}

const createSchema = z.object({
  code: z
    .string()
    .min(4)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, "Use letters, numbers, _ or -"),
  label: z.string().max(120).optional().nullable(),
  max_uses: z.number().int().positive().optional().nullable(),
  expires_at: z.string().datetime().optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const auth = await getAdminClient();
    if (!auth) return forbidden("Admin access required");
    const { supabase, user } = auth;

    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    const { data, error } = await supabase
      .from("signup_invites")
      .insert({
        code: parsed.data.code.trim().toUpperCase(),
        label: parsed.data.label ?? null,
        max_uses: parsed.data.max_uses ?? null,
        expires_at: parsed.data.expires_at ?? null,
        created_by: user.id,
        enabled: true,
      })
      .select("*")
      .single();

    if (error) return fail(error.message, 400);
    await writeAuditLog(supabase, "create_signup_invite", "signup_invite", data.id, {
      code: data.code,
    });
    return created(data);
  } catch (e) {
    console.error(e);
    return serverError();
  }
}

const patchSchema = z.object({
  id: z.string().uuid(),
  enabled: z.boolean().optional(),
  max_uses: z.number().int().positive().nullable().optional(),
  label: z.string().max(120).nullable().optional(),
});

export async function PATCH(request: Request) {
  try {
    const auth = await getAdminClient();
    if (!auth) return forbidden("Admin access required");

    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    const { id, ...fields } = parsed.data;
    const { data, error } = await auth.supabase
      .from("signup_invites")
      .update({ ...fields, updated_at: new Date().toISOString() })
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
