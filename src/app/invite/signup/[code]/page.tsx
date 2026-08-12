import { ThemeToggle } from "@/components/theme-toggle";
import { SignupInviteLanding } from "@/features/auth/signup-invite-landing";
import { BrandWordmark } from "@/components/brand-wordmark";

export default async function SignupInvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cleaned = decodeURIComponent(code).trim();

  return (
    <div className="gradient-mesh relative flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-4 py-5 sm:px-6">
        <BrandWordmark href="/" size="md" replayKey="signup-invite-brand" />
        <ThemeToggle compact />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <SignupInviteLanding code={cleaned} />
      </main>
    </div>
  );
}
