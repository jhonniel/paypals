import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { User, SupabaseClient } from "@supabase/supabase-js";

export async function getAuthedClient(): Promise<{
  supabase: SupabaseClient;
  user: User;
} | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;
  return { supabase, user };
}

export async function getAdminClient(): Promise<{
  supabase: SupabaseClient;
  user: User;
} | null> {
  const auth = await getAuthedClient();
  if (!auth) return null;

  const { data: profile } = await auth.supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (!profile?.is_admin) return null;
  return auth;
}

export async function writeAuditLog(
  supabase: SupabaseClient,
  action: string,
  entityType: string,
  entityId?: string | null,
  metadata?: Record<string, unknown>
) {
  try {
    await supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity_type: entityType,
      p_entity_id: entityId ?? null,
      p_metadata: metadata ?? {},
    });
  } catch {
    /* audit is best-effort */
  }
}
