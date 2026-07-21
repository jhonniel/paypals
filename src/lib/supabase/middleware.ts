import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeRedirectPath } from "@/lib/security";
import { AUTH_ERROR_COOKIE } from "@/lib/oauth-cookies";

function clearSupabaseCookies(response: NextResponse, request: NextRequest) {
  for (const c of request.cookies.getAll()) {
    if (
      c.name.startsWith("sb-") ||
      c.name.includes("auth-token") ||
      c.name.startsWith("supabase")
    ) {
      response.cookies.set(c.name, "", {
        path: "/",
        maxAge: 0,
      });
    }
  }
}

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // OAuth callback must not run getUser() before the browser exchanges the code
  if (pathname.startsWith("/auth/callback")) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  let user: { id: string } | null = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      // Stale/invalid refresh tokens are common after aborted Google OAuth on mobile.
      // Never let this crash middleware into a 500.
      console.warn("[middleware] auth.getUser:", error.message);
      clearSupabaseCookies(supabaseResponse, request);
    } else {
      user = data.user;
    }
  } catch (e) {
    console.warn("[middleware] auth.getUser threw", e);
    clearSupabaseCookies(supabaseResponse, request);
    user = null;
  }

  const authError =
    request.nextUrl.searchParams.get("error") ||
    request.cookies.get(AUTH_ERROR_COOKIE)?.value ||
    null;

  const isAppRoute =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/groups") ||
    pathname.startsWith("/receipts") ||
    pathname.startsWith("/friends") ||
    pathname.startsWith("/analytics") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/profile") ||
    pathname.startsWith("/admin");

  const isAuthRoute =
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/magic-link");

  const isClaimInvite = pathname.startsWith("/claim-invite");
  const isLoginOrSignup =
    pathname.startsWith("/login") || pathname.startsWith("/signup");

  // OAuth rejection flash: always allow login/signup to render the error
  if (
    isLoginOrSignup &&
    (authError || request.nextUrl.searchParams.has("error"))
  ) {
    return supabaseResponse;
  }

  if (!user && isAppRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (!user && isClaimInvite) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", "/claim-invite");
    return NextResponse.redirect(url);
  }

  if (user && (isAuthRoute || isClaimInvite || isAppRoute)) {
    let inviteVerified = false;
    try {
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("invite_verified, is_admin")
        .eq("id", user.id)
        .maybeSingle();

      const migrationMissing =
        profileError?.message?.includes("invite_verified") ||
        profileError?.code === "42703";

      inviteVerified = migrationMissing
        ? true
        : profile == null
          ? false
          : profile.invite_verified === undefined
            ? true
            : Boolean(profile.invite_verified) || Boolean(profile.is_admin);
    } catch (e) {
      console.warn("[middleware] profile lookup failed", e);
      inviteVerified = false;
    }

    if (!inviteVerified && isAppRoute) {
      const url = request.nextUrl.clone();
      url.pathname = "/claim-invite";
      url.search = "";
      return NextResponse.redirect(url);
    }

    if (inviteVerified && isClaimInvite) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }

    if (isAuthRoute && inviteVerified) {
      const next = safeRedirectPath(
        request.nextUrl.searchParams.get("next"),
        "/dashboard"
      );
      return NextResponse.redirect(new URL(next, request.url));
    }

    // Unverified session on login/signup: clear it so "Sign in" from the
    // landing page shows the login form instead of forcing an invite code.
    if (isAuthRoute && !inviteVerified) {
      try {
        await supabase.auth.signOut();
      } catch {
        /* ignore */
      }
      clearSupabaseCookies(supabaseResponse, request);
      return supabaseResponse;
    }
  }

  return supabaseResponse;
}
