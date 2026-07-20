"use client";

import { useEffect, useState } from "react";

/**
 * If Supabase Site URL is `/`, Google often returns here with ?code=…
 * instead of /auth/callback — forward so the not-registered error can run.
 */
export function OAuthHomeCatch() {
  const [catching, setCatching] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const hasCode = url.searchParams.has("code");
    const hasOAuthError =
      url.searchParams.has("error") ||
      url.searchParams.has("error_description");
    const hash = url.hash.replace(/^#/, "");
    const hasHashToken =
      hash.includes("access_token") || hash.includes("error=");

    if (!hasCode && !hasOAuthError && !hasHashToken) return;

    setCatching(true);
    const dest = new URL("/auth/callback", url.origin);
    url.searchParams.forEach((value, key) => {
      dest.searchParams.set(key, value);
    });
    // Preserve mode/next from helper cookies if Site URL stripped query extras
    window.location.replace(dest.pathname + dest.search + (hash ? `#${hash}` : ""));
  }, []);

  if (!catching) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background text-sm text-muted-foreground">
      Continuing sign-in…
    </div>
  );
}
