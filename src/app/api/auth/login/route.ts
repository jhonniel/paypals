import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createServerClient } from "@supabase/ssr";
import { fromZod, tooManyRequests } from "@/lib/api";
import { NOT_SIGNED_UP_MESSAGE } from "@/lib/auth-messages";
import { notifyAccessRequest } from "@/lib/email/notify";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  const limited = rateLimit(`login:${ip}`, { limit: 10, windowMs: 60_000 });
  if (!limited.ok) return tooManyRequests(limited.retryAfterSec);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey || supabaseUrl.includes("placeholder")) {
    return NextResponse.json(
      {
        error: {
          code: "ENV_MISSING",
          message:
            "Supabase is not configured. Check NEXT_PUBLIC_SUPABASE_URL and ANON_KEY.",
        },
      },
      { status: 500 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Invalid JSON body" } },
      { status: 400 }
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  const cookieJar: { name: string; value: string; options?: Record<string, unknown> }[] =
    [];

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookieJar.push(...cookiesToSet);
      },
    },
  });

  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    const raw = (error.message || "").toLowerCase();
    let message = "Invalid email or password";
    let code = "UNAUTHORIZED";

    if (raw.includes("email not confirmed") || raw.includes("not confirmed")) {
      message =
        "Email not confirmed yet. Check your inbox or use a confirmed demo account.";
    } else if (raw.includes("rate") || error.status === 429) {
      message = "Too many attempts. Wait a minute and try again.";
    } else if (
      raw.includes("invalid login") ||
      raw.includes("invalid credentials") ||
      raw.includes("user not found") ||
      raw.includes("no user")
    ) {
      // Supabase uses the same error for unknown accounts and wrong passwords.
      message =
        "Couldn't sign you in. If you’re new here, your account is not signed up yet — Paypals is invite-only, ask Ygay!";
      code = "NOT_SIGNED_UP";
      void notifyAccessRequest({
        email: parsed.data.email,
        source: "email",
      }).catch(() => null);
    }

    console.error("[login]", error.message, error.status);
    return NextResponse.json(
      { error: { code, message } },
      { status: 401 }
    );
  }

  // Block invite-unverified accounts (same gate as Google login)
  if (data.user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("invite_verified, is_admin")
      .eq("id", data.user.id)
      .maybeSingle();

    const verified =
      Boolean(profile?.invite_verified) || Boolean(profile?.is_admin);

    if (!verified) {
      void notifyAccessRequest({
        email: parsed.data.email,
        source: "email",
        name: (data.user.user_metadata?.full_name as string | undefined) ?? null,
      }).catch(() => null);

      await supabase.auth.signOut();
      const clear = NextResponse.json(
        {
          error: {
            code: "NOT_SIGNED_UP",
            message: NOT_SIGNED_UP_MESSAGE,
          },
        },
        { status: 401 }
      );
      for (const { name } of cookieJar) {
        clear.cookies.set(name, "", { path: "/", maxAge: 0 });
      }
      return clear;
    }
  }

  const response = NextResponse.json({
    data: {
      user: {
        id: data.user?.id,
        email: data.user?.email,
      },
    },
  });

  const secure = process.env.NODE_ENV === "production";
  for (const { name, value, options } of cookieJar) {
    response.cookies.set(name, value, {
      ...(options as Record<string, unknown>),
      secure: secure || Boolean(options?.secure),
      sameSite: (options?.sameSite as "lax" | "strict" | "none" | undefined) ?? "lax",
      httpOnly: options?.httpOnly !== false,
      path: typeof options?.path === "string" ? options.path : "/",
    });
  }

  return response;
}
