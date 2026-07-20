"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { safeRedirectPath } from "@/lib/security";
import { flashAuthError } from "@/lib/auth-error-flash";

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`));
  if (!match) return "";
  return decodeURIComponent(match.split("=").slice(1).join("=") || "");
}

function clearOAuthHelperCookies() {
  for (const name of [
    "paypals_oauth_invite",
    "paypals_oauth_next",
    "paypals_oauth_mode",
  ]) {
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
  }
}

function go(path: string) {
  window.location.replace(path);
}

const CODE_LOCK_PREFIX = "paypals_oauth_code:";

function claimOAuthCode(code: string): boolean {
  try {
    const key = CODE_LOCK_PREFIX + code;
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, "1");
    return true;
  } catch {
    return true;
  }
}

/**
 * Completes Google OAuth in the browser and gates invite-only access locally.
 * Does not rely on server cookies (those often fail on mobile).
 */
export function OAuthCallbackClient() {
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("Finishing sign-in…");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const supabase = createClient();

      const code = searchParams.get("code");
      const oauthError =
        searchParams.get("error_description") ||
        searchParams.get("error") ||
        "";

      const modeParam =
        searchParams.get("mode") || readCookie("paypals_oauth_mode") || "login";
      const mode = modeParam === "signup" ? "signup" : "login";
      const next = safeRedirectPath(
        searchParams.get("next") ||
          readCookie("paypals_oauth_next") ||
          "/dashboard",
        "/dashboard"
      );
      const invite =
        searchParams.get("invite")?.trim() ||
        searchParams.get("invite_code")?.trim() ||
        readCookie("paypals_oauth_invite") ||
        "";

      const failToAuth = (errorCode: string) => {
        if (cancelled) return;
        clearOAuthHelperCookies();
        flashAuthError(errorCode);
        const dest =
          mode === "signup"
            ? `/signup?error=${encodeURIComponent(errorCode)}${invite ? `&invite=${encodeURIComponent(invite)}` : ""}`
            : `/login?error=${encodeURIComponent(errorCode)}`;
        go(dest);
      };

      if (oauthError && !code) {
        failToAuth("auth_callback");
        return;
      }

      try {
        if (code) {
          const claimed = claimOAuthCode(code);
          if (claimed) {
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (error) {
              console.error("exchangeCodeForSession", error.message);
              // React Strict Mode / remount may race: if a session already exists, continue
              const {
                data: { session },
              } = await supabase.auth.getSession();
              if (!session) {
                failToAuth("auth_callback");
                return;
              }
            }
          } else {
            // Another run already claimed this code — wait briefly for session
            for (let i = 0; i < 20; i++) {
              const {
                data: { session },
              } = await supabase.auth.getSession();
              if (session) break;
              await new Promise((r) => setTimeout(r, 50));
            }
            const {
              data: { session },
            } = await supabase.auth.getSession();
            if (!session) {
              failToAuth("auth_callback");
              return;
            }
          }
        } else {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          if (!session) {
            failToAuth("auth_callback");
            return;
          }
        }

        if (cancelled) return;
        setMessage("Checking your account…");

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          failToAuth("auth_callback");
          return;
        }

        const metaInvite =
          typeof user.user_metadata?.invite_code === "string"
            ? user.user_metadata.invite_code.trim()
            : "";
        const inviteToRedeem = invite || metaInvite;

        // Always redeem when we have a code — covers email-confirm links
        // (mode may be "login") and Google signup with invite.
        if (inviteToRedeem) {
          const { data: redeemed } = await supabase.rpc("redeem_signup_invite", {
            p_code: inviteToRedeem,
          });
          const r = redeemed as { ok?: boolean; group_id?: string } | null;
          if (r?.ok) {
            clearOAuthHelperCookies();
            try {
              const { sendAccessConfirmedEmail } = await import(
                "@/lib/email/notify"
              );
              if (user.email) {
                void sendAccessConfirmedEmail({
                  to: user.email,
                  name:
                    (user.user_metadata?.full_name as string | undefined) ||
                    (user.user_metadata?.name as string | undefined) ||
                    null,
                });
              }
            } catch {
              /* ignore */
            }
            go(r.group_id ? `/groups/${r.group_id}` : next);
            return;
          }
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("invite_verified, is_admin, created_at")
          .eq("id", user.id)
          .maybeSingle();

        const verified =
          Boolean(profile?.invite_verified) || Boolean(profile?.is_admin);

        if (verified) {
          clearOAuthHelperCookies();
          go(next);
          return;
        }

        // Not registered — notify Ygay, sign out, cleanup stub user
        const errorCode =
          mode === "signup" ? "invite_required" : "google_not_registered";

        const attemptedEmail = user.email || "";
        if (attemptedEmail) {
          try {
            void fetch("/api/auth/access-request", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email: attemptedEmail,
                source: mode === "signup" ? "signup" : "google",
                name:
                  (user.user_metadata?.full_name as string | undefined) ||
                  (user.user_metadata?.name as string | undefined) ||
                  null,
              }),
            });
          } catch {
            /* ignore */
          }
        }

        try {
          await supabase.auth.signOut();
        } catch {
          /* ignore */
        }

        // Best-effort cleanup — do not block the error redirect on mobile
        try {
          void fetch("/api/auth/oauth-finish", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode,
              invite: invite || undefined,
              next,
              cleanupOnly: true,
              userId: user.id,
            }),
          });
        } catch {
          /* ignore */
        }

        failToAuth(errorCode);
      } catch (e) {
        console.error(e);
        failToAuth("auth_callback");
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
