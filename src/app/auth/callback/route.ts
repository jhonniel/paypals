import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { safeRedirectPath } from "@/lib/security";
import {
  AUTH_ERROR_COOKIE,
  INVITE_COOKIE,
  NEXT_COOKIE,
  MODE_COOKIE,
  readOAuthCookies,
} from "@/lib/oauth-cookies";
import { createAdminClient } from "@/lib/supabase/admin";

type CookieToSet = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

function clearAuthCookiesOnResponse(
  response: NextResponse,
  request: NextRequest
) {
  const secure = process.env.NODE_ENV === "production";
  for (const c of request.cookies.getAll()) {
    // Supabase SSR auth cookies (project-ref prefixed)
    if (
      c.name.startsWith("sb-") ||
      c.name.includes("auth-token") ||
      c.name.startsWith("supabase")
    ) {
      response.cookies.set(c.name, "", {
        path: "/",
        maxAge: 0,
        sameSite: "lax",
        secure,
        httpOnly: true,
      });
    }
  }
}

function redirectWithCookies(
  request: NextRequest,
  origin: string,
  path: string,
  jar: CookieToSet[],
  opts?: { authError?: string; clearSession?: boolean }
) {
  const response = NextResponse.redirect(`${origin}${path}`);
  const secure = process.env.NODE_ENV === "production";

  for (const { name, value, options } of jar) {
    // When rejecting, skip writing fresh session cookies from the OAuth exchange
    if (
      opts?.clearSession &&
      (name.startsWith("sb-") ||
        name.includes("auth-token") ||
        name.startsWith("supabase"))
    ) {
      continue;
    }
    response.cookies.set(name, value, {
      ...(options as Record<string, unknown>),
      secure: secure || Boolean(options?.secure),
      sameSite:
        (options?.sameSite as "lax" | "strict" | "none" | undefined) ?? "lax",
      httpOnly: options?.httpOnly !== false,
      path: typeof options?.path === "string" ? options.path : "/",
    });
  }

  for (const name of [INVITE_COOKIE, NEXT_COOKIE, MODE_COOKIE]) {
    response.cookies.set(name, "", { path: "/", maxAge: 0 });
  }

  if (opts?.clearSession) {
    clearAuthCookiesOnResponse(response, request);
    // Also expire any auth cookie names that appeared in the jar
    for (const { name } of jar) {
      if (
        name.startsWith("sb-") ||
        name.includes("auth-token") ||
        name.startsWith("supabase")
      ) {
        response.cookies.set(name, "", {
          path: "/",
          maxAge: 0,
          sameSite: "lax",
          secure,
          httpOnly: true,
        });
      }
    }
  }

  if (opts?.authError) {
    response.cookies.set(AUTH_ERROR_COOKIE, opts.authError, {
      path: "/",
      maxAge: 60 * 5,
      sameSite: "lax",
      secure,
      httpOnly: false,
    });
  }

  return response;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const cookieState = await readOAuthCookies();

  const modeParam = searchParams.get("mode") || cookieState.mode;
  const mode = modeParam === "signup" ? "signup" : "login";

  const next = safeRedirectPath(
    searchParams.get("next") || cookieState.next || "/dashboard",
    "/dashboard"
  );
  const invite =
    searchParams.get("invite")?.trim() ||
    searchParams.get("invite_code")?.trim() ||
    cookieState.invite ||
    "";

  const cookieJar: CookieToSet[] = [];
  const redirect = (
    path: string,
    opts?: { authError?: string; clearSession?: boolean }
  ) => redirectWithCookies(request, origin, path, cookieJar, opts);

  if (!code) {
    return redirect("/login?error=auth_callback", {
      authError: "auth_callback",
      clearSession: true,
    });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookieJar.push(...cookiesToSet);
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return redirect(
      `/login?error=${encodeURIComponent(error.message || "auth_callback")}`,
      { authError: "auth_callback", clearSession: true }
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect("/login?error=auth_callback", {
      authError: "auth_callback",
      clearSession: true,
    });
  }

  let inviteCode = invite;
  if (!inviteCode && user.user_metadata?.invite_code) {
    inviteCode = String(user.user_metadata.invite_code);
  }

  // Only redeem invites during signup — never auto-register via the login button
  if (mode === "signup" && inviteCode) {
    const { data: redeemed } = await supabase.rpc("redeem_signup_invite", {
      p_code: inviteCode,
    });
    const r = redeemed as { ok?: boolean; group_id?: string } | null;
    if (r?.ok) {
      if (r.group_id) {
        return redirect(`/groups/${r.group_id}`);
      }
      return redirect(next);
    }
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("invite_verified, is_admin, created_at")
    .eq("id", user.id)
    .maybeSingle();

  const verified =
    Boolean(profile?.invite_verified) || Boolean(profile?.is_admin);

  if (verified) {
    return redirect(next);
  }

  // Not invite-verified → block and send back to auth with a clear error
  try {
    await supabase.auth.signOut({ scope: "global" });
  } catch (e) {
    console.error("Failed to sign out unverified Google user", e);
  }

  const createdAt = profile?.created_at
    ? new Date(profile.created_at).getTime()
    : user.created_at
      ? new Date(user.created_at).getTime()
      : 0;
  const isBrandNew = createdAt > 0 && Date.now() - createdAt < 15 * 60 * 1000;
  if (isBrandNew) {
    try {
      const admin = createAdminClient();
      await admin.auth.admin.deleteUser(user.id);
    } catch (e) {
      console.error("Failed to delete unverified Google user", e);
    }
  }

  const message =
    mode === "signup" ? "invite_required" : "google_not_registered";

  const dest =
    mode === "signup"
      ? `/signup?error=${message}${inviteCode ? `&invite=${encodeURIComponent(inviteCode)}` : ""}`
      : `/login?error=${message}`;

  return redirect(dest, { authError: message, clearSession: true });
}
