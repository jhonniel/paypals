import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeRedirectPath } from "@/lib/security";
import { AUTH_ERROR_COOKIE } from "@/lib/oauth-cookies";

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

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
  // (also when hash/query is present — do not bounce to claim-invite)
  if (
    isLoginOrSignup &&
    (authError ||
      request.nextUrl.searchParams.has("error") ||
      request.nextUrl.hash.includes("error="))
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
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("invite_verified, is_admin")
      .eq("id", user.id)
      .maybeSingle();

    const migrationMissing =
      profileError?.message?.includes("invite_verified") ||
      profileError?.code === "42703";

    const inviteVerified = migrationMissing
      ? true
      : profile == null
        ? false
        : profile.invite_verified === undefined
          ? true
          : Boolean(profile.invite_verified) || Boolean(profile.is_admin);

    if (!inviteVerified && isAppRoute) {
      const url = request.nextUrl.clone();
      url.pathname = "/claim-invite";
      url.search = "";
      return NextResponse.redirect(url);
    }

    if (inviteVerified && isClaimInvite) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }

    if (user && isAuthRoute && inviteVerified) {
      const next = safeRedirectPath(
        request.nextUrl.searchParams.get("next"),
        "/dashboard"
      );
      return NextResponse.redirect(new URL(next, request.url));
    }

    if (user && isAuthRoute && !inviteVerified) {
      return NextResponse.redirect(new URL("/claim-invite", request.url));
    }
  }

  return supabaseResponse;
}
