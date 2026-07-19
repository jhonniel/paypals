import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { GuestClaimView } from "@/features/groups/guest-claim";

export default async function GuestInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <div className="gradient-mesh relative flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-4 py-5 sm:px-6">
        <Link
          href="/"
          className="font-[family-name:var(--font-display)] text-2xl tracking-tight"
        >
          Paypals
        </Link>
        <ThemeToggle compact />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <GuestClaimView token={token} />
      </main>
    </div>
  );
}
