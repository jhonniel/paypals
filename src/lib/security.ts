/** Returns a same-origin relative path, or the fallback. Blocks open redirects. */
export function safeRedirectPath(
  value: string | null | undefined,
  fallback = "/dashboard"
): string {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return fallback;
  if (trimmed.includes("\\") || trimmed.includes("@")) return fallback;
  // Disallow protocol-relative and absolute URLs smuggled in
  try {
    const url = new URL(trimmed, "https://paypals.local");
    if (url.origin !== "https://paypals.local") return fallback;
    return `${url.pathname}${url.search}${url.hash}` || fallback;
  } catch {
    return fallback;
  }
}

export function isProduction() {
  return process.env.NODE_ENV === "production";
}
