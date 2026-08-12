/**
 * Resolve the public site origin for invite / auth links.
 * Prefer the live request (or browser) host so copied links don't stick to a
 * stale NEXT_PUBLIC_APP_URL (e.g. localhost in production emails).
 */
export function getAppOrigin(request?: Request | null): string {
  if (request) {
    const forwardedHost = request.headers.get("x-forwarded-host");
    const host = (forwardedHost ?? request.headers.get("host") ?? "")
      .split(",")[0]
      ?.trim();
    if (host) {
      const forwardedProto = request.headers
        .get("x-forwarded-proto")
        ?.split(",")[0]
        ?.trim();
      const proto =
        forwardedProto ||
        (host.includes("localhost") || host.startsWith("127.")
          ? "http"
          : "https");
      return `${proto}://${host}`.replace(/\/$/, "");
    }
  }

  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin.replace(/\/$/, "");
  }

  const raw =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    "http://localhost:3000";

  if (/^https?:\/\//i.test(raw)) {
    return raw.replace(/\/$/, "");
  }

  return `https://${raw.replace(/\/$/, "")}`;
}

export function absoluteAppUrl(path: string, request?: Request | null): string {
  const origin = getAppOrigin(request);
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${normalized}`;
}
