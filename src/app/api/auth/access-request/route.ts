import { z } from "zod";
import { ok, fromZod, tooManyRequests, fail } from "@/lib/api";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { notifyAccessRequest } from "@/lib/email/notify";
import { isSmtpConfigured, inviteAdminEmail } from "@/lib/email/smtp";

const schema = z.object({
  email: z.string().email(),
  source: z.enum(["google", "email", "signup", "other"]).default("other"),
  name: z.string().max(120).optional().nullable(),
});

/**
 * Public endpoint: notify invite admin (Ygay) that someone needs an invite.
 * Rate-limited. No-ops gracefully when SMTP is not configured.
 */
export async function POST(request: Request) {
  const ip = clientIp(request);
  const limited = rateLimit(`access-request:${ip}`, {
    limit: 5,
    windowMs: 60_000,
  });
  if (!limited.ok) return tooManyRequests(limited.retryAfterSec);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fromZod(parsed.error);

  if (!isSmtpConfigured() || !inviteAdminEmail()) {
    return ok({
      notified: false,
      reason: "Email notifications are not configured",
    });
  }

  // Per-email throttle so the same address can't spam Ygay
  const emailKey = parsed.data.email.trim().toLowerCase();
  const emailLimit = rateLimit(`access-request-email:${emailKey}`, {
    limit: 3,
    windowMs: 60 * 60 * 1000,
  });
  if (!emailLimit.ok) {
    return ok({ notified: false, reason: "Already notified recently" });
  }

  const result = await notifyAccessRequest({
    email: parsed.data.email,
    source: parsed.data.source,
    name: parsed.data.name,
  });

  if (!result.sent) {
    return fail(result.error || "Failed to send notification", 502);
  }

  return ok({ notified: true });
}
