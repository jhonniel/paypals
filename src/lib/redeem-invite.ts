import type { SupabaseClient } from "@supabase/supabase-js";

type RedeemResult = {
  ok: boolean;
  reason?: string;
  label?: string | null;
};

/**
 * Redeem a signup invite for a user.
 * Prefer the DB RPC; if it fails (e.g. boolean cast bug), fall back to service-role updates.
 */
export async function redeemSignupInviteForUser(
  supabase: SupabaseClient,
  inviteCode: string,
  userId: string
): Promise<RedeemResult> {
  const code = inviteCode.trim();
  if (code.length < 4) return { ok: false, reason: "missing" };

  const { data, error } = await supabase.rpc("redeem_signup_invite", {
    p_code: code,
  });

  if (!error) {
    const r = data as { ok?: boolean; reason?: string; label?: string } | null;
    if (r?.ok) return { ok: true, label: r.label ?? null };
    // Fall through to admin path for soft failures (exhausted/invalid still fail there)
    if (r?.reason === "exhausted" || r?.reason === "invalid" || r?.reason === "not_found") {
      return { ok: false, reason: r.reason };
    }
  } else {
    console.error("[redeem] rpc error", error.message);
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      ok: false,
      reason: error?.message?.includes("boolean")
        ? "rpc_boolean_bug"
        : "rpc_failed",
    };
  }

  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();

    const { data: validation, error: validateError } = await admin.rpc(
      "validate_signup_invite",
      { p_code: code }
    );
    if (validateError) {
      return { ok: false, reason: validateError.message };
    }

    const v = validation as {
      valid?: boolean;
      kind?: string;
      invite_id?: string;
      label?: string;
      reason?: string;
    };

    if (!v?.valid || v.kind !== "app" || !v.invite_id) {
      return { ok: false, reason: v?.reason ?? "invalid" };
    }

    const { data: inviteRow, error: inviteReadError } = await admin
      .from("signup_invites")
      .select("id, use_count, max_uses, enabled")
      .eq("id", v.invite_id)
      .maybeSingle();

    if (inviteReadError || !inviteRow) {
      return { ok: false, reason: "not_found" };
    }

    const useCount = Number(inviteRow.use_count ?? 0);
    const maxUses =
      inviteRow.max_uses == null ? null : Number(inviteRow.max_uses);
    if (!inviteRow.enabled || (maxUses != null && useCount >= maxUses)) {
      return { ok: false, reason: "exhausted" };
    }

    const nextCount = useCount + 1;
    const { error: inviteUpdateError } = await admin
      .from("signup_invites")
      .update({
        use_count: nextCount,
        ...(maxUses != null && nextCount >= maxUses ? { enabled: false } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", inviteRow.id)
      .eq("enabled", true);

    if (inviteUpdateError) {
      return { ok: false, reason: inviteUpdateError.message };
    }

    const { error: profileError } = await admin
      .from("profiles")
      .update({
        invite_verified: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (profileError) {
      return { ok: false, reason: profileError.message };
    }

    return { ok: true, label: v.label ?? null };
  } catch (e) {
    console.error("[redeem] admin fallback failed", e);
    return { ok: false, reason: "admin_fallback_failed" };
  }
}
