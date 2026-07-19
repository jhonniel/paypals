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

function generateInviteCode(length = 10): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const createSchema = z.object({
  /** Optional — server generates a unique code when omitted (single create only). */
  code: z
    .string()
    .min(4)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, "Use letters, numbers, _ or -")
    .optional(),
  label: z.string().max(120).optional().nullable(),
  expires_at: z.string().datetime().optional().nullable(),
  /** How many unique single-use codes to create (1–50). */
  count: z.number().int().min(1).max(50).optional().default(1),
});

export async function POST(request: Request) {
  try {
    const auth = await getAdminClient();
    if (!auth) return forbidden("Admin access required");
    const { supabase, user } = auth;

    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    const count = parsed.data.count ?? 1;
    if (parsed.data.code && count > 1) {
      return fail("Custom code can only be used when creating one invite", 400);
    }

    const rows: Array<{
      code: string;
      label: string | null;
      max_uses: number;
      expires_at: string | null;
      created_by: string;
      enabled: boolean;
    }> = [];

    const used = new Set<string>();
    for (let i = 0; i < count; i++) {
      let code = (parsed.data.code?.trim() || generateInviteCode()).toUpperCase();
      // Avoid collisions within this batch
      let tries = 0;
      while (used.has(code) && !parsed.data.code) {
        code = generateInviteCode().toUpperCase();
        tries += 1;
        if (tries > 20) break;
      }
      used.add(code);
      const labelBase = parsed.data.label?.trim() || null;
      rows.push({
        code,
        label:
          count > 1 && labelBase
            ? `${labelBase} (${i + 1}/${count})`
            : labelBase,
        max_uses: 1,
        expires_at: parsed.data.expires_at ?? null,
        created_by: user.id,
        enabled: true,
      });
    }

    const { data, error } = await supabase
      .from("signup_invites")
      .insert(rows)
      .select("*");

    if (error) {
      if (/duplicate|unique/i.test(error.message)) {
        return fail("One or more invite codes already exist — try again", 400);
      }
      return fail(error.message, 400);
    }

    const createdRows = data ?? [];
    await writeAuditLog(supabase, "create_signup_invite", "signup_invite", null, {
      count: createdRows.length,
      codes: createdRows.map((r) => r.code),
      max_uses: 1,
    });

    if (createdRows.length === 1) {
      return created(createdRows[0]);
    }

    return created({
      count: createdRows.length,
      invites: createdRows,
      codes: createdRows.map((r) => r.code),
    });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}

const patchSchema = z.object({
  id: z.string().uuid(),
  enabled: z.boolean().optional(),
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
