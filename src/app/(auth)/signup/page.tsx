import { Suspense } from "react";
import { AuthShell } from "@/features/auth/auth-shell";
import { SignupForm } from "@/features/auth/signup-form";

export default function SignupPage() {
  return (
    <AuthShell
      title="Create your account"
      description="Invite-only access. Enter your code, then sign up with Google or email."
    >
      <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-muted" />}>
        <SignupForm />
      </Suspense>
    </AuthShell>
  );
}
