import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeRedirectPath } from "@/lib/security";

export async function updateSession(request: NextRequest) {
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

  const pathname = request.nextUrl.pathname;
  const authError = request.nextUrl.searchParams.get("error");
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

    // Migration 004 not applied → column missing; allow access
    const migrationMissing =
      profileError?.message?.includes("invite_verified") ||
      profileError?.code === "42703";

    // No profile row → treat as unverified (do not auto-pass into the app)
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

    // Logged in but unverified on login/signup:
    // Keep them on the page when showing an OAuth rejection error
    // (otherwise middleware strips ?error= and they never see the message).
    if (user && isAuthRoute && !inviteVerified) {
      if (
        authError &&
        (pathname.startsWith("/login") || pathname.startsWith("/signup"))
      ) {
        return supabaseResponse;
      }
      return NextResponse.redirect(new URL("/claim-invite", request.url));
    }
  }

  return supabaseResponse;
}
