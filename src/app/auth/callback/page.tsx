import { Suspense } from "react";
import { OAuthCallbackClient } from "@/features/auth/oauth-callback";

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
          Finishing sign-in…
        </div>
      }
    >
      <OAuthCallbackClient />
    </Suspense>
  );
}
