import Link from "next/link";
import { BrandWordmark } from "@/components/brand-wordmark";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata = {
  title: "Offline",
};

export default function OfflinePage() {
  return (
    <div className="gradient-mesh relative flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-4 py-5 sm:px-6">
        <BrandWordmark href="/" size="md" replayKey="offline-brand" />
        <ThemeToggle compact />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 pb-16 text-center">
        <div className="glass max-w-md rounded-3xl p-8">
          <h1 className="text-xl font-semibold">You&apos;re offline</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Paypals needs an internet connection to sync receipts, groups, and balances.
            Reconnect and try again.
          </p>
          <Button asChild className="mt-6 w-full">
            <Link href="/dashboard">Try again</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
