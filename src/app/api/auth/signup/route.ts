import { z } from "zod";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { fromZod, fail, ok, tooManyRequests } from "@/lib/api";
import { publicEnv } from "@/lib/env";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { safeRedirectPath } from "@/lib/security";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(2),
  inviteCode: z.string().min(4).max(64),
});

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limited = rateLimit(`signup:${ip}`, { limit: 5, windowMs: 60_000 });
  if (!limited.ok) return tooManyRequests(limited.retryAfterSec);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key || url.includes("placeholder")) {
    return fail("Supabase is not configured", 500, "ENV_MISSING");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("Invalid JSON body");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

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

  const { data: validation, error: validateError } = await supabase.rpc(
    "validate_signup_invite",
    { p_code: parsed.data.inviteCode }
  );

  if (validateError) return fail(validateError.message, 400);
  const invite = validation as { valid?: boolean; kind?: string; group_id?: string; label?: string };
  if (!invite?.valid) {
    return fail("A valid invite code is required to create an account", 403, "INVITE_REQUIRED");
  }

  const nextPath =
    invite.kind === "group" && invite.group_id
      ? `/groups/${invite.group_id}`
      : "/dashboard";

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: {
        full_name: parsed.data.fullName,
        invite_code: parsed.data.inviteCode.trim(),
      },
      emailRedirectTo: `${publicEnv.appUrl}/auth/callback?next=${encodeURIComponent(nextPath)}&invite=${encodeURIComponent(parsed.data.inviteCode.trim())}`,
    },
  });

  if (error) return fail(error.message, 400, "SIGNUP_FAILED");

  let redeemed = false;
  let groupId: string | null = invite.group_id ?? null;

  if (data.session) {
    const { data: redeemResult, error: redeemError } = await supabase.rpc(
      "redeem_signup_invite",
      { p_code: parsed.data.inviteCode }
    );
    if (redeemError) {
      console.error(redeemError);
    } else {
      const r = redeemResult as { ok?: boolean; group_id?: string };
      redeemed = Boolean(r?.ok);
      if (r?.group_id) groupId = r.group_id;
    }
  }

  return ok({
    user: data.user ? { id: data.user.id, email: data.user.email } : null,
    needsConfirmation: !data.session,
    redeemed,
    groupId,
    redirectTo: safeRedirectPath(
      groupId ? `/groups/${groupId}` : "/dashboard",
      "/dashboard"
    ),
  });
}
