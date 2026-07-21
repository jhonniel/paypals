import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient } from "@supabase/ssr";
import { fromZod, fail, tooManyRequests } from "@/lib/api";
import { publicEnv } from "@/lib/env";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { sendAccessConfirmedEmail } from "@/lib/email/notify";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(2),
  inviteCode: z.string().min(4).max(64),
});

type CookieEntry = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

function applyCookies(response: NextResponse, cookieJar: CookieEntry[]) {
  const secure = process.env.NODE_ENV === "production";
  for (const { name, value, options } of cookieJar) {
    response.cookies.set(name, value, {
      ...(options as Record<string, unknown>),
      secure: secure || Boolean(options?.secure),
      sameSite:
        (options?.sameSite as "lax" | "strict" | "none" | undefined) ?? "lax",
      httpOnly: options?.httpOnly !== false,
      path: typeof options?.path === "string" ? options.path : "/",
    });
  }
  return response;
}

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
  const cookieJar: CookieEntry[] = [];

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return [];
      },
      setAll(cookiesToSet) {
        cookieJar.push(...cookiesToSet);
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
  if (data.user && !data.session && process.env.SUPABASE_SERVICE_ROLE_KEY) {
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

      // Fresh jar for the post-confirm sign-in session
      cookieJar.length = 0;
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
      console.error("[signup] redeem failed", redeemError);
    } else {
      const r = redeemResult as { ok?: boolean; reason?: string } | null;
      redeemed = Boolean(r?.ok);
      if (!redeemed) {
        console.error("[signup] redeem returned", r);
      }
    }

    // Admin fallback if RPC didn't mark the profile verified
    if (!redeemed && data.user && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const { createAdminClient } = await import("@/lib/supabase/admin");
        const admin = createAdminClient();
        const { error: profileError } = await admin
          .from("profiles")
          .update({ invite_verified: true })
          .eq("id", data.user.id);

        if (!profileError) {
          redeemed = true;
          // Best-effort: mark invite used (service role has no auth.uid for RPC)
          const cleaned = inviteCode.toLowerCase();
          const { data: inviteRow } = await admin
            .from("signup_invites")
            .select("id, use_count, max_uses, code")
            .ilike("code", cleaned)
            .maybeSingle();
          if (inviteRow) {
            const nextCount = Number(inviteRow.use_count ?? 0) + 1;
            const maxUses = inviteRow.max_uses == null ? null : Number(inviteRow.max_uses);
            await admin
              .from("signup_invites")
              .update({
                use_count: nextCount,
                ...(maxUses != null && nextCount >= maxUses
                  ? { enabled: false }
                  : {}),
              })
              .eq("id", inviteRow.id);
          }
        }
      } catch (e) {
        console.error("[signup] admin verify fallback failed", e);
      }
    }

    if (!redeemed) {
      await supabase.auth.signOut().catch(() => null);
      const failed = NextResponse.json(
        {
          error: {
            code: "INVITE_REDEEM_FAILED",
            message:
              "Account was created but the invite could not be applied. Ask an admin for a fresh invite code, then try again from Sign in → claim invite.",
          },
        },
        { status: 400 }
      );
      // Clear any partial session cookies
      for (const { name } of cookieJar) {
        failed.cookies.set(name, "", { path: "/", maxAge: 0 });
      }
      return failed;
    }

    if (data.user?.email) {
      void sendAccessConfirmedEmail({
        to: data.user.email,
        name: parsed.data.fullName,
      }).catch(() => null);
    }
  }

  const response = NextResponse.json({
    data: {
      user: data.user ? { id: data.user.id, email: data.user.email } : null,
      needsConfirmation: !data.session,
      redeemed,
      groupId: null,
      redirectTo: "/dashboard",
    },
  });

  return applyCookies(response, cookieJar);
}
