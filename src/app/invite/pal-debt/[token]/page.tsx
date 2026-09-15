import { ThemeToggle } from "@/components/theme-toggle";
import { BrandWordmark } from "@/components/brand-wordmark";
import { PalDebtClaimView } from "@/features/pal-owes-me/pal-debt-claim";

export default async function PalDebtInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <div className="gradient-mesh relative flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-4 py-5 sm:px-6">
        <BrandWordmark href="/" size="md" replayKey="pal-debt-invite-brand" />
        <ThemeToggle compact />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <PalDebtClaimView token={token} />
      </main>
    </div>
  );
}
