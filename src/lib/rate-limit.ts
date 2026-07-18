import { isProduction } from "@/lib/security";

type RateBucket = { count: number; resetAt: number };

const buckets = new Map<string, RateBucket>();

/**
 * Simple in-memory rate limiter (per serverless instance).
 * Good enough for abuse damping; use Upstash/Redis for multi-region hard limits.
 */
export function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number }
): { ok: boolean; remaining: number; retryAfterSec: number } {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { ok: true, remaining: opts.limit - 1, retryAfterSec: 0 };
  }

  if (existing.count >= opts.limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSec: Math.ceil((existing.resetAt - now) / 1000),
    };
  }

  existing.count += 1;
  return {
    ok: true,
    remaining: opts.limit - existing.count,
    retryAfterSec: 0,
  };
}

export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") ?? "unknown";
}

export function logError(scope: string, error: unknown) {
  if (isProduction()) {
    console.error(`[${scope}]`, error instanceof Error ? error.message : "error");
    return;
  }
  console.error(`[${scope}]`, error);
}
