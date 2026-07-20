import { z } from "zod";
import { ok, fromZod } from "@/lib/api";

const bodySchema = z.object({
  mode: z.enum(["login", "signup"]).optional(),
  invite: z.string().max(64).optional(),
  next: z.string().max(500).optional(),
  cleanupOnly: z.boolean().optional(),
  userId: z.string().uuid().optional(),
});

/**
 * Best-effort cleanup after the browser rejects an unverified Google login.
 * Never throws a 500 — missing service role is a no-op.
 */
export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return fromZod(parsed.error);

    if (
      parsed.data.cleanupOnly &&
      parsed.data.userId &&
      process.env.SUPABASE_SERVICE_ROLE_KEY &&
      process.env.NEXT_PUBLIC_SUPABASE_URL
    ) {
      try {
        const { createAdminClient } = await import("@/lib/supabase/admin");
        const admin = createAdminClient();
        await admin.auth.admin.deleteUser(parsed.data.userId);
      } catch (e) {
        console.error("oauth-finish cleanup", e);
      }
    }

    return ok({ cleaned: true });
  } catch (e) {
    console.error("oauth-finish", e);
    // Still 200 so mobile clients are not blocked by cleanup failures
    return ok({ cleaned: false });
  }
}
