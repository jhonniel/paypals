import type { SupabaseClient } from "@supabase/supabase-js";

export const SIGNUP_INVITE_RETENTION_DAYS = 7;

export function signupInviteCleanupCutoffIso(
  days = SIGNUP_INVITE_RETENTION_DAYS
): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function isExhaustedInvite(row: {
  use_count: number;
  max_uses: number | null;
}): boolean {
  if (row.max_uses == null || row.use_count <= 0) return false;
  return row.use_count >= row.max_uses;
}

/** Deletes fully used invites older than the retention window. Best-effort. */
export async function cleanupExhaustedSignupInvites(
  supabase: SupabaseClient
): Promise<number> {
  const cutoff = signupInviteCleanupCutoffIso();

  const { data: rpcCount, error: rpcError } = await supabase.rpc(
    "cleanup_exhausted_signup_invites",
    { p_older_than: `${SIGNUP_INVITE_RETENTION_DAYS} days` }
  );

  if (!rpcError && typeof rpcCount === "number") {
    return rpcCount;
  }

  if (rpcError && !/cleanup_exhausted_signup_invites|42883|does not exist/i.test(rpcError.message)) {
    console.error("[signup-invite-cleanup] rpc failed", rpcError.message);
  }

  const { data: rows, error: selectError } = await supabase
    .from("signup_invites")
    .select("id, use_count, max_uses, updated_at")
    .gt("use_count", 0)
    .not("max_uses", "is", null)
    .lt("updated_at", cutoff);

  if (selectError) {
    console.error("[signup-invite-cleanup] select failed", selectError.message);
    return 0;
  }

  const ids = (rows ?? [])
    .filter((row) => isExhaustedInvite(row))
    .map((row) => row.id);

  if (!ids.length) return 0;

  const { error: deleteError } = await supabase
    .from("signup_invites")
    .delete()
    .in("id", ids);

  if (deleteError) {
    console.error("[signup-invite-cleanup] delete failed", deleteError.message);
    return 0;
  }

  return ids.length;
}
