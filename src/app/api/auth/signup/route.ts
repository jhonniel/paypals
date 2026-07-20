import { z } from "zod";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { fromZod, fail, ok, tooManyRequests } from "@/lib/api";
import { publicEnv } from "@/lib/env";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { sendAccessConfirmedEmail } from "@/lib/email/notify";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(2),
  inviteCode: z.string().min(4).max(64),
});

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limited = rateLimit(`signup:${ip}`, { limit: 5, windowMs: 60_000 });
  if (!limited.ok) return tooManyRequests(limited.retryAfterSec);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key || url.includes("placeholder")) {
    return fail("Supabase is not configured", 500, "ENV_MISSING");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("Invalid JSON body");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  const inviteCode = parsed.data.inviteCode.trim();
  const cookieStore = await cookies();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          /* ignore */
        }
      },
    },
  });

  const { data: validation, error: validateError } = await supabase.rpc(
    "validate_signup_invite",
    { p_code: inviteCode }
  );

  if (validateError) return fail(validateError.message, 400);
  const invite = validation as {
    valid?: boolean;
    kind?: string;
    group_id?: string;
    label?: string;
  };
  if (!invite?.valid || invite.kind !== "app") {
    return fail(
      "A valid admin invite code is required to create an account",
      403,
      "INVITE_REQUIRED"
    );
  }

  const nextPath = "/dashboard";
  const emailRedirectTo = `${publicEnv.appUrl}/auth/callback?mode=signup&next=${encodeURIComponent(nextPath)}&invite=${encodeURIComponent(inviteCode)}`;

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: {
        full_name: parsed.data.fullName,
        invite_code: inviteCode,
      },
      emailRedirectTo,
    },
  });

  if (error) return fail(error.message, 400, "SIGNUP_FAILED");

  // Invite-only apps: confirm email immediately when service role is available,
  // then redeem the invite so login works without waiting on a confirm link.
  if (
    data.user &&
    !data.session &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    try {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const admin = createAdminClient();
      await admin.auth.admin.updateUserById(data.user.id, {
        email_confirm: true,
        user_metadata: {
          full_name: parsed.data.fullName,
          invite_code: inviteCode,
        },
      });

      const { data: signedIn, error: signInError } =
        await supabase.auth.signInWithPassword({
          email: parsed.data.email,
          password: parsed.data.password,
        });

      if (!signInError && signedIn.session) {
        data.session = signedIn.session;
      }
    } catch (e) {
      console.error("[signup] auto-confirm failed", e);
    }
  }

  let redeemed = false;

  if (data.session) {
    const { data: redeemResult, error: redeemError } = await supabase.rpc(
      "redeem_signup_invite",
      { p_code: inviteCode }
    );
    if (redeemError) {
      console.error(redeemError);
    } else {
      const r = redeemResult as { ok?: boolean };
      redeemed = Boolean(r?.ok);
    }

    if (redeemed && data.user?.email) {
      void sendAccessConfirmedEmail({
        to: data.user.email,
        name: parsed.data.fullName,
      }).catch(() => null);
    }
  }

  return ok({
    user: data.user ? { id: data.user.id, email: data.user.email } : null,
    needsConfirmation: !data.session,
    redeemed,
    groupId: null,
    redirectTo: "/dashboard",
  });
}
