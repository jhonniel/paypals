import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const started = Date.now();
  const checks: Record<string, boolean> = {
    env: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
        !process.env.NEXT_PUBLIC_SUPABASE_URL.includes("placeholder")
    ),
    appUrl: Boolean(process.env.NEXT_PUBLIC_APP_URL),
    serviceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    ocr: Boolean(
      process.env.OCR_SPACE_API_KEY ||
        process.env.GOOGLE_VISION_API_KEY ||
        process.env.OPENAI_API_KEY
    ),
    database: false,
  };

  try {
    const supabase = await createClient();
    const { error } = await supabase.from("profiles").select("id").limit(1);
    checks.database = !error;
  } catch {
    checks.database = false;
  }

  const healthy = checks.env && checks.database;
  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
      latencyMs: Date.now() - started,
      checks,
      timestamp: new Date().toISOString(),
    },
    {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
