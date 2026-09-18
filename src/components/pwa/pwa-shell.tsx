"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function PwaShell() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [dismissed, setDismissed] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) {
      setInstalled(true);
      return;
    }

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };

    const onInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
        console.warn("[pwa] service worker registration failed", err);
      });
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function installApp() {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === "accepted") {
      setInstallEvent(null);
    }
    setDismissed(true);
  }

  if (installed || dismissed || !installEvent) return null;

  return (
    <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 px-4 sm:bottom-6 sm:left-auto sm:right-6 sm:max-w-sm sm:px-0">
      <div className="glass flex items-start gap-3 rounded-2xl border border-primary/20 p-3 shadow-lg">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
          <Download className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Install Paypals</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Add to your home screen for quick access like a native app.
          </p>
          <div className="mt-2 flex gap-2">
            <Button type="button" size="sm" className="h-8" onClick={() => void installApp()}>
              Install
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={() => setDismissed(true)}
            >
              Not now
            </Button>
          </div>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-muted"
          aria-label="Dismiss install prompt"
          onClick={() => setDismissed(true)}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
