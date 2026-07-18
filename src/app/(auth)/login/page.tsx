import { Suspense } from "react";
import { AuthShell } from "@/features/auth/auth-shell";
import { LoginForm } from "@/features/auth/login-form";

export default function LoginPage() {
  return (
    <AuthShell title="Welcome back" description="Sign in to split bills with friends.">
      <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-muted" />}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
