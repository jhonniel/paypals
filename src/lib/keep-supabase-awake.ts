export type KeepAwakeCheck = {
  label: string;
  url: string;
  ok: boolean;
  status?: number;
  ms?: number;
  error?: string;
};

async function ping(
  label: string,
  url: string,
  init?: RequestInit
): Promise<KeepAwakeCheck> {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(20_000),
    });
    const ms = Date.now() - started;
    const ok = res.ok || res.status === 401 || res.status === 404;
    return { label, url, ok, status: res.status, ms };
  } catch (err) {
    return {
      label,
      url,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Ping Supabase (and optionally the deployed app) to prevent free-tier pause. */
export async function runKeepSupabaseAwake(options?: {
  appUrl?: string;
}): Promise<{ ok: boolean; checks: KeepAwakeCheck[] }> {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(
    /\/$/,
    ""
  );
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const appUrl = (
    options?.appUrl ||
    process.env.KEEP_AWAKE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    ""
  ).replace(/\/$/, "");

  if (!supabaseUrl || supabaseUrl.includes("placeholder")) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  }

  const checks: KeepAwakeCheck[] = [];

  checks.push(
    await ping("supabase auth health", `${supabaseUrl}/auth/v1/health`)
  );

  if (anonKey) {
    checks.push(
      await ping(
        "supabase rest",
        `${supabaseUrl}/rest/v1/profiles?select=id&limit=1`,
        {
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`,
            Prefer: "count=exact",
          },
        }
      )
    );
  }

  if (appUrl && !appUrl.includes("localhost")) {
    checks.push(await ping("app health", `${appUrl}/api/health`));
  }

  const ok = checks.every((c) => c.ok);
  return { ok, checks };
}
