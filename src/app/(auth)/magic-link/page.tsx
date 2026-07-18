import { AuthShell } from "@/features/auth/auth-shell";
import { MagicLinkForm } from "@/features/auth/magic-link-form";

export default function MagicLinkPage() {
  return (
    <AuthShell
      title="Magic link"
      description="We'll email you a secure one-tap sign-in link."
    >
      <MagicLinkForm />
    </AuthShell>
  );
}
