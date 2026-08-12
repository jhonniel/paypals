import { ThemeToggle } from "@/components/theme-toggle";
import { BrandWordmark } from "@/components/brand-wordmark";

export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="gradient-mesh relative flex min-h-dvh flex-col overflow-x-hidden">
      <header className="flex items-center justify-between px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:py-5">
        <BrandWordmark href="/" size="md" replayKey="auth-brand" />
        <ThemeToggle compact />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-[max(2rem,env(safe-area-inset-bottom))] sm:items-center sm:pb-16">
        <div className="glass w-full max-w-md rounded-2xl p-5 sm:rounded-3xl sm:p-8">
          <div className="mb-6 space-y-2 text-center sm:mb-8">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
