import { AuthShell } from "@/features/auth/auth-shell";
import { ClaimInviteForm } from "@/features/auth/claim-invite-form";

export default function ClaimInvitePage() {
  return (
    <AuthShell
      title="Almost there"
      description="Confirm your invite to unlock the full Paypals experience."
    >
      <ClaimInviteForm />
    </AuthShell>
  );
}
