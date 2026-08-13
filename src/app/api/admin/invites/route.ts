import { z } from "zod";
import { getAdminClient, writeAuditLog } from "@/lib/supabase/auth";
import { ok, forbidden, fail, fromZod, serverError, created } from "@/lib/api";
import { sendSignupInviteEmail } from "@/lib/email/notify";
import { isSmtpConfigured } from "@/lib/email/smtp";
import { getAppOrigin } from "@/lib/app-origin";
import { signupInviteUrl } from "@/lib/signup-invite-url";
import { cleanupExhaustedSignupInvites } from "@/lib/signup-invite-cleanup";

function withInviteUrls<T extends { code: string }>(
  rows: T[],
  request?: Request
) {
  const origin = getAppOrigin(request);
  return rows.map((row) => ({
    ...row,
    invite_url: signupInviteUrl(row.code, origin),
  }));
}

export async function GET(request: Request) {
  try {
    const auth = await getAdminClient();
    if (!auth) return forbidden("Admin access required");

    await cleanupExhaustedSignupInvites(auth.supabase);

    const { data, error } = await auth.supabase
      .from("signup_invites")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) return fail(error.message, 400);
    return ok(withInviteUrls(data ?? [], request));
  } catch (e) {
    console.error(e);
    return serverError();
  }
}

/** Unique invite codes — longer alphabet reduces collision risk for shareable links. */
function generateInviteCode(length = 12): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const createSchema = z.object({
  /** Optional — server generates a unique code when omitted. */
  code: z
    .string()
    .min(4)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, "Use letters, numbers, _ or -")
    .optional(),
  label: z.string().max(120).optional().nullable(),
  expires_at: z.string().datetime().optional().nullable(),
  /** How many people can sign up with this one link (default 10). */
  max_uses: z.number().int().min(1).max(1000).optional().default(10),
  /** Optional — email the invite link to this address via SMTP */
  send_to: z.string().email().optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const auth = await getAdminClient();
    if (!auth) return forbidden("Admin access required");
    const { supabase, user } = auth;

    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    const maxUses = parsed.data.max_uses ?? 10;
    const code = (parsed.data.code?.trim() || generateInviteCode()).toUpperCase();

    const row = {
      code,
      label: parsed.data.label?.trim() || null,
      max_uses: maxUses,
      expires_at: parsed.data.expires_at ?? null,
      created_by: user.id,
      enabled: true,
    };

    const { data, error } = await supabase
      .from("signup_invites")
      .insert(row)
      .select("*");

    if (error) {
      if (/duplicate|unique/i.test(error.message)) {
        return fail("Invite code already exists — try again", 400);
      }
      return fail(error.message, 400);
    }

    const createdRows = withInviteUrls(data ?? [], request);
    await writeAuditLog(supabase, "create_signup_invite", "signup_invite", null, {
      code: createdRows[0]?.code,
      max_uses: maxUses,
    });

    let emailed: { sent: boolean; error?: string } | null = null;
    const sendTo = parsed.data.send_to?.trim();
    if (sendTo) {
      if (!isSmtpConfigured()) {
        emailed = { sent: false, error: "SMTP is not configured" };
      } else {
        const { data: adminProfile } = await supabase
          .from("profiles")
          .select("full_name, email")
          .eq("id", user.id)
          .maybeSingle();
        emailed = await sendSignupInviteEmail({
          to: sendTo,
          codes: createdRows.map((r) => r.code),
          label: parsed.data.label,
          fromName: adminProfile?.full_name || adminProfile?.email || "Paypals admin",
          baseUrl: getAppOrigin(request),
        });
      }
    }

    if (createdRows.length === 1) {
      return created({ ...createdRows[0], emailed });
    }

    return created({ invites: createdRows, emailed });
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

const deleteSchema = z.object({
  id: z.string().uuid(),
});

export async function DELETE(request: Request) {
  try {
    const auth = await getAdminClient();
    if (!auth) return forbidden("Admin access required");

    const parsed = deleteSchema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    const { error } = await auth.supabase
      .from("signup_invites")
      .delete()
      .eq("id", parsed.data.id);

    if (error) return fail(error.message, 400);

    await writeAuditLog(auth.supabase, "delete_signup_invite", "signup_invite", parsed.data.id);
    return ok({ deleted: true });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
