const ERROR_STORAGE_KEY = "paypals_auth_error";

/** Survives redirects better than cookies on mobile Safari. */
export function flashAuthError(code: string) {
  try {
    sessionStorage.setItem(ERROR_STORAGE_KEY, code);
  } catch {
    /* private mode */
  }
  if (typeof document !== "undefined") {
    document.cookie = `paypals_auth_error=${encodeURIComponent(code)}; Path=/; Max-Age=300; SameSite=Lax`;
  }
}

export function consumeAuthErrorFlash(): string | null {
  let code: string | null = null;
  try {
    code = sessionStorage.getItem(ERROR_STORAGE_KEY);
    sessionStorage.removeItem(ERROR_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return code;
}
