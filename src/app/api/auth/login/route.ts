import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createServerClient } from "@supabase/ssr";
import { fromZod, tooManyRequests } from "@/lib/api";
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
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid email or password" } },
      { status: 401 }
    );
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
