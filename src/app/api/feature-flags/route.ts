import { z } from "zod";
import { getAuthedClient, getAdminClient, writeAuditLog } from "@/lib/supabase/auth";
import { ok, unauthorized, forbidden, serverError, fail, fromZod, created } from "@/lib/api";

export async function GET() {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { data, error } = await auth.supabase
      .from("feature_flags")
      .select("key, enabled, description, metadata, updated_at")
      .order("key");
    if (error) return fail(error.message, 400);
    return ok(data ?? []);
  } catch (e) {
    console.error(e);
    return serverError();
  }
}

const upsertSchema = z.object({
  key: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, "Use snake_case keys"),
  enabled: z.boolean(),
  description: z.string().max(280).optional().nullable(),
});

export async function PUT(request: Request) {
  try {
    const auth = await getAdminClient();
    if (!auth) return forbidden("Admin access required");
    const { supabase, user } = auth;

    const body = await request.json();
    const parsed = upsertSchema.safeParse(body);
    if (!parsed.success) return fromZod(parsed.error);

    const { data, error } = await supabase
      .from("feature_flags")
      .upsert({
        key: parsed.data.key,
        enabled: parsed.data.enabled,
        description: parsed.data.description ?? null,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .select("*")
      .single();

    if (error) return fail(error.message, 400);

    await writeAuditLog(supabase, "upsert_feature_flag", "feature_flag", null, {
      key: parsed.data.key,
      enabled: parsed.data.enabled,
    });

    return ok(data);
  } catch (e) {
    console.error(e);
    return serverError();
  }
}

const createSchema = upsertSchema;

export async function POST(request: Request) {
  try {
    const auth = await getAdminClient();
    if (!auth) return forbidden("Admin access required");
    const { supabase, user } = auth;

    const body = await request.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return fromZod(parsed.error);

    const { data, error } = await supabase
      .from("feature_flags")
      .insert({
        key: parsed.data.key,
        enabled: parsed.data.enabled,
        description: parsed.data.description ?? null,
        updated_by: user.id,
      })
      .select("*")
      .single();

    if (error) return fail(error.message, 400);
    await writeAuditLog(supabase, "create_feature_flag", "feature_flag", null, {
      key: parsed.data.key,
    });
    return created(data);
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
