import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fromZod, serverError } from "@/lib/api";

const bodySchema = z.object({
  mode: z.enum(["login", "signup"]).default("login"),
  invite: z.string().max(64).optional(),
  next: z.string().max(500).optional(),
  /** Client already gated; just delete the stub auth user if possible */
  cleanupOnly: z.boolean().optional(),
  userId: z.string().uuid().optional(),
});

/**
 * Best-effort cleanup after the browser rejects an unverified Google login.
 * Invite gating happens client-side now (mobile-safe).
 */
export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return fromZod(parsed.error);

    if (parsed.data.cleanupOnly && parsed.data.userId) {
      try {
        const admin = createAdminClient();
        await admin.auth.admin.deleteUser(parsed.data.userId);
      } catch (e) {
        console.error("oauth-finish cleanup", e);
      }
      return ok({ cleaned: true });
    }

    return ok({ ok: true });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
