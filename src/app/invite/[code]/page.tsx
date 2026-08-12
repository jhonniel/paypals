import { ThemeToggle } from "@/components/theme-toggle";
import { InviteJoinView } from "@/features/groups/invite-join";
import { BrandWordmark } from "@/components/brand-wordmark";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code: raw } = await params;
  const code = decodeURIComponent(raw).trim();
  return (
    <div className="gradient-mesh relative flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-4 py-5 sm:px-6">
        <BrandWordmark href="/" size="md" replayKey="invite-brand" />
        <ThemeToggle compact />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <InviteJoinView code={code} />
      </main>
    </div>
  );
}
