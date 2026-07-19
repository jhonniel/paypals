import { createClient } from "@/lib/supabase/server";
import { ok, fail, serverError, tooManyRequests } from "@/lib/api";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/** Preview / validate a signup invite without redeeming it. */
export async function GET(request: Request) {
  try {
    const ip = clientIp(request);
    const limited = rateLimit(`invite-check:${ip}`, { limit: 30, windowMs: 60_000 });
    if (!limited.ok) return tooManyRequests(limited.retryAfterSec);

    const code = new URL(request.url).searchParams.get("code")?.trim() ?? "";
    if (code.length < 4) return fail("Enter a valid invite code", 400);

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("validate_signup_invite", {
      p_code: code,
    });

    if (error) return fail(error.message, 400);

    const result = data as {
      valid?: boolean;
      kind?: string;
      label?: string;
      reason?: string;
      group_id?: string;
    };

    if (!result?.valid || result.kind !== "app") {
      const messages: Record<string, string> = {
        missing: "Invite code is required",
        disabled: "This invite has been disabled",
        expired: "This invite has expired",
        exhausted: "This invite was already used — ask an admin for a new one",
        not_found: "Invalid invite code — ask an admin for a signup invite",
      };
      return fail(
        messages[result?.reason ?? ""] ??
          "Invalid invite code — ask an admin for a signup invite",
        400,
        "INVALID_INVITE"
      );
    }

    return ok({
      valid: true,
      kind: "app",
      label: result.label,
      groupId: null,
    });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
