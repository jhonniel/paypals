import { cookies } from "next/headers";

export const INVITE_COOKIE = "paypals_oauth_invite";
export const NEXT_COOKIE = "paypals_oauth_next";
export const MODE_COOKIE = "paypals_oauth_mode";
/** Flash error after OAuth rejection (readable by the login/signup client). */
export const AUTH_ERROR_COOKIE = "paypals_auth_error";

export async function readOAuthCookies() {
  const jar = await cookies();
  return {
    invite: jar.get(INVITE_COOKIE)?.value?.trim() ?? "",
    next: jar.get(NEXT_COOKIE)?.value?.trim() ?? "",
    mode: jar.get(MODE_COOKIE)?.value?.trim() ?? "",
  };
}

export async function clearOAuthCookies() {
  const jar = await cookies();
  jar.delete(INVITE_COOKIE);
  jar.delete(NEXT_COOKIE);
  jar.delete(MODE_COOKIE);
}
