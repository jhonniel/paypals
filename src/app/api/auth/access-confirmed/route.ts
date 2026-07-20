import { getAuthedClient } from "@/lib/supabase/auth";
import { ok, unauthorized, serverError } from "@/lib/api";
import { sendAccessConfirmedEmail } from "@/lib/email/notify";

/** Authenticated: send the “access confirmed” welcome email (server-only SMTP). */
export async function POST() {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { user } = auth;
    if (!user.email) return ok({ sent: false });

    const result = await sendAccessConfirmedEmail({
      to: user.email,
      name:
        (user.user_metadata?.full_name as string | undefined) ||
        (user.user_metadata?.name as string | undefined) ||
        null,
    });

    return ok({ sent: result.sent, error: result.error });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
