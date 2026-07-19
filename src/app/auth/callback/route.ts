import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/security";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeRedirectPath(searchParams.get("next"), "/dashboard");
  const invite =
    searchParams.get("invite")?.trim() ||
    searchParams.get("invite_code")?.trim() ||
    "";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      let inviteCode = invite;
      if (!inviteCode && user?.user_metadata?.invite_code) {
        inviteCode = String(user.user_metadata.invite_code);
      }

      if (inviteCode) {
        const { data: redeemed } = await supabase.rpc("redeem_signup_invite", {
          p_code: inviteCode,
        });
        const r = redeemed as { ok?: boolean; group_id?: string } | null;
        if (r?.ok && r.group_id) {
          return NextResponse.redirect(`${origin}/groups/${r.group_id}`);
        }
      }

      // New Google users without invite must claim one
      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("invite_verified")
          .eq("id", user.id)
          .maybeSingle();

        if (profile && profile.invite_verified === false) {
          return NextResponse.redirect(`${origin}/claim-invite`);
        }
        // Column missing / migration not applied → allow through
        if (profile && profile.invite_verified == null) {
          /* ignore */
        }
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback`);
}
