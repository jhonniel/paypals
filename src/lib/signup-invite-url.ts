import { publicEnv } from "@/lib/env";

/** Unique one-time signup invite link for a given admin invite code. */
export function signupInviteUrl(code: string, baseUrl?: string): string {
  const origin = (baseUrl || publicEnv.appUrl).replace(/\/$/, "");
  const cleaned = code.trim();
  return `${origin}/invite/signup/${encodeURIComponent(cleaned)}`;
}

/** Signup page with invite prefilled (fallback / email deep link). */
export function signupPageWithInvite(code: string, baseUrl?: string): string {
  const origin = (baseUrl || publicEnv.appUrl).replace(/\/$/, "");
  return `${origin}/signup?invite=${encodeURIComponent(code.trim())}`;
}
