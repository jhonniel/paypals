"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { publicEnv } from "@/lib/env";
import { safeRedirectPath } from "@/lib/security";
import { Button } from "@/components/ui/button";

export function GoogleButton({
  next = "/dashboard",
  label = "Continue with Google",
  inviteCode,
  disabled = false,
}: {
  next?: string;
  label?: string;
  inviteCode?: string;
  disabled?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const safeNext = safeRedirectPath(
    next.startsWith("/auth/callback") ? "/dashboard" : next,
    "/dashboard"
  );

  async function handleGoogle() {
    if (disabled) {
      toast.error("Enter a valid invite code first");
      return;
    }
    if (!publicEnv.isConfigured) {
      toast.error("Supabase is not configured. Add env vars to .env.local");
      return;
    }

    setLoading(true);
    const supabase = createClient();

    const callbackParams = new URLSearchParams();
    callbackParams.set("next", safeNext);
    if (inviteCode && inviteCode.length >= 4) {
      callbackParams.set("invite", inviteCode);
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${publicEnv.appUrl}/auth/callback?${callbackParams.toString()}`,
        queryParams: inviteCode
          ? undefined
          : undefined,
      },
    });

    if (error) {
      toast.error(error.message);
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={() => void handleGoogle()}
      disabled={loading || disabled}
    >
      {loading ? (
        <Loader2 className="animate-spin" />
      ) : (
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
          <path
            fill="currentColor"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="currentColor"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="currentColor"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          />
          <path
            fill="currentColor"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
      )}
      {label}
    </Button>
  );
}
