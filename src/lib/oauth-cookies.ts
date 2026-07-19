import { cookies } from "next/headers";

export const INVITE_COOKIE = "paypals_oauth_invite";
export const NEXT_COOKIE = "paypals_oauth_next";

export async function readOAuthCookies() {
  const jar = await cookies();
  return {
    invite: jar.get(INVITE_COOKIE)?.value?.trim() ?? "",
    next: jar.get(NEXT_COOKIE)?.value?.trim() ?? "",
  };
}

export async function clearOAuthCookies() {
  const jar = await cookies();
  jar.delete(INVITE_COOKIE);
  jar.delete(NEXT_COOKIE);
}
