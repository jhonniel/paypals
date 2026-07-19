import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/security";
import { clearOAuthCookies, readOAuthCookies } from "@/lib/oauth-cookies";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const mode = searchParams.get("mode") === "signup" ? "signup" : "login";
  const cookieState = await readOAuthCookies();

  const next = safeRedirectPath(
    searchParams.get("next") || cookieState.next || "/dashboard",
    "/dashboard"
  );
  const invite =
    searchParams.get("invite")?.trim() ||
    searchParams.get("invite_code")?.trim() ||
    cookieState.invite ||
    "";

  if (!code) {
    await clearOAuthCookies();
    return NextResponse.redirect(`${origin}/login?error=auth_callback`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    await clearOAuthCookies();
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    await clearOAuthCookies();
    return NextResponse.redirect(`${origin}/login?error=auth_callback`);
  }

  let inviteCode = invite;
  if (!inviteCode && user.user_metadata?.invite_code) {
    inviteCode = String(user.user_metadata.invite_code);
  }

  // Signup via Google must redeem invite immediately
  if (inviteCode) {
    const { data: redeemed } = await supabase.rpc("redeem_signup_invite", {
      p_code: inviteCode,
    });
    const r = redeemed as { ok?: boolean; group_id?: string } | null;
    if (r?.ok) {
      await clearOAuthCookies();
      if (r.group_id) {
        return NextResponse.redirect(`${origin}/groups/${r.group_id}`);
      }
      return NextResponse.redirect(`${origin}${next}`);
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
    await clearOAuthCookies();
    return NextResponse.redirect(`${origin}${next}`);
  }

  // Not invite-verified: block access (login or incomplete signup)
  await supabase.auth.signOut();
  await clearOAuthCookies();

  // Remove brand-new OAuth accounts that never redeemed an invite
  const createdAt = profile?.created_at
    ? new Date(profile.created_at).getTime()
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
    mode === "signup"
      ? "invite_required"
      : "google_not_registered";

  const dest =
    mode === "signup"
      ? `/signup?error=${message}${inviteCode ? `&invite=${encodeURIComponent(inviteCode)}` : ""}`
      : `/login?error=${message}`;

  return NextResponse.redirect(`${origin}${dest}`);
}
