import { runKeepSupabaseAwake } from "@/lib/keep-supabase-awake";
import { fail, ok, serverError, unauthorized } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

function isCronAuthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret) {
    return req.headers.get("authorization") === `Bearer ${cronSecret}`;
  }
  return req.headers.get("x-vercel-cron") === "1";
}

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return unauthorized("Cron only");
  }

  try {
    const result = await runKeepSupabaseAwake();
    if (!result.ok) {
      return fail("Keep-awake check failed", 503, "KEEP_AWAKE_FAILED", {
        checks: result.checks,
      });
    }
    return ok({
      message: "Keep-awake OK — Supabase should stay active",
      checks: result.checks,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("cron/keep-awake:", err);
    return serverError(
      err instanceof Error ? err.message : "Keep-awake failed"
    );
  }
}
