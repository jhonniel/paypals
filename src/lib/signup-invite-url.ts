import { absoluteAppUrl, getAppOrigin } from "@/lib/app-origin";

/** Unique one-time signup invite link for a given admin invite code. */
export function signupInviteUrl(code: string, baseUrl?: string): string {
  const origin = (baseUrl || getAppOrigin()).replace(/\/$/, "");
  const cleaned = code.trim();
  return `${origin}/invite/signup/${encodeURIComponent(cleaned)}`;
}

/** Signup page with invite prefilled (fallback / email deep link). */
export function signupPageWithInvite(code: string, baseUrl?: string): string {
  const origin = (baseUrl || getAppOrigin()).replace(/\/$/, "");
  return `${origin}/signup?invite=${encodeURIComponent(code.trim())}`;
}

/** Group invite link (lost/found-style join). */
export function groupInviteUrl(code: string, baseUrl?: string): string {
  const origin = (baseUrl || getAppOrigin()).replace(/\/$/, "");
  return `${origin}/invite/${encodeURIComponent(code.trim())}`;
}

export function groupInviteUrlFromRequest(code: string, request: Request): string {
  return absoluteAppUrl(`/invite/${encodeURIComponent(code.trim())}`, request);
}

export function signupInviteUrlFromRequest(code: string, request: Request): string {
  return absoluteAppUrl(
    `/invite/signup/${encodeURIComponent(code.trim())}`,
    request
  );
}
