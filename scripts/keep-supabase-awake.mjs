#!/usr/bin/env node
/**
 * Keep a free-tier Supabase project from pausing due to inactivity.
 *
 * Usage:
 *   node scripts/keep-supabase-awake.mjs
 *   npm run keep-awake
 *
 * Env (from .env.local or CI secrets):
 *   NEXT_PUBLIC_SUPABASE_URL   (required)
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY (optional, used for a light REST ping)
 *   NEXT_PUBLIC_APP_URL or KEEP_AWAKE_URL (optional — also hits /api/health)
 *
 * Schedule with GitHub Actions (.github/workflows/keep-supabase-awake.yml)
 * every 5 days, or a local cron (day-of-month step 5), e.g.:
 *   0 8 1-31/5 * * cd /path/to/Paypals && npm run keep-awake
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(resolve(process.cwd(), ".env.local"));
loadEnvFile(resolve(process.cwd(), ".env"));

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(
  /\/$/,
  ""
);
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const appUrl = (
  process.env.KEEP_AWAKE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  ""
).replace(/\/$/, "");

if (!supabaseUrl || supabaseUrl.includes("placeholder")) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL");
  process.exit(1);
}

async function ping(label, url, init) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(20_000),
    });
    const ms = Date.now() - started;
    const ok = res.ok || res.status === 401 || res.status === 404;
    console.log(
      `${ok ? "✓" : "✗"} ${label} → ${res.status} (${ms}ms) ${url}`
    );
    return ok;
  } catch (err) {
    console.error(
      `✗ ${label} → ${err instanceof Error ? err.message : String(err)}`
    );
    return false;
  }
}

const results = [];

// Auth health does not require a key and wakes the project
results.push(
  await ping("supabase auth health", `${supabaseUrl}/auth/v1/health`)
);

// Light REST touch (needs anon key) — confirms DB path is warm
if (anonKey) {
  results.push(
    await ping("supabase rest", `${supabaseUrl}/rest/v1/profiles?select=id&limit=1`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Prefer: "count=exact",
      },
    })
  );
} else {
  console.log("· skip rest ping (no NEXT_PUBLIC_SUPABASE_ANON_KEY)");
}

if (appUrl && !appUrl.includes("localhost")) {
  results.push(await ping("app health", `${appUrl}/api/health`));
} else if (appUrl) {
  console.log("· skip app health (localhost — use KEEP_AWAKE_URL in CI)");
}

const failed = results.filter((r) => !r).length;
if (failed > 0) {
  console.error(`Keep-awake finished with ${failed} failed check(s)`);
  process.exit(1);
}

console.log("Keep-awake OK — Supabase should stay active");
