"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppTopbar } from "@/components/layout/app-topbar";
import { CommandPalette } from "@/components/layout/command-palette";
import { AnnouncementGate } from "@/features/announcements/announcement-gate";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/cn";
import type { Profile } from "@/types/database";
import { useMobileKeyboardOpen } from "@/hooks/use-mobile-keyboard";

export function AppShell({
  profile,
  children,
}: {
  profile: Profile | null;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const keyboardOpen = useMobileKeyboardOpen();

  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [mobileOpen]);

  // Close the slide-out menu when the keyboard opens
  useEffect(() => {
    if (keyboardOpen) setMobileOpen(false);
  }, [keyboardOpen]);

  return (
    <div className="flex h-dvh max-h-dvh overflow-hidden bg-background">
      <div className="hidden lg:fixed lg:inset-y-0 lg:z-30 lg:flex lg:w-64 lg:flex-col">
        <AppSidebar profile={profile} />
      </div>

      <div
        className={cn(
          "fixed inset-0 z-50 lg:hidden",
          mobileOpen ? "pointer-events-auto" : "pointer-events-none"
        )}
        aria-hidden={!mobileOpen}
      >
        <div
          className={cn(
            "absolute inset-0 bg-black/50 transition-opacity duration-200",
            mobileOpen ? "opacity-100" : "opacity-0"
          )}
          onClick={() => setMobileOpen(false)}
        />
        <div
          className={cn(
            "absolute inset-y-0 left-0 flex w-[min(18rem,88vw)] max-w-full flex-col bg-sidebar shadow-2xl transition-transform duration-300 ease-out",
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <div className="flex items-center justify-end p-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <AppSidebar
              profile={profile}
              onNavigate={() => setMobileOpen(false)}
            />
          </div>
        </div>
      </div>

      {/*
        Mobile: shell fills the dynamic viewport; only <main> scrolls.
        Keeps the dock pinned (Safari jumps fixed bottom bars when the URL bar hides).
      */}
      <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col lg:pl-64">
        <AppTopbar
          profile={profile}
          onMenuClick={() => setMobileOpen(true)}
          onSearchClick={() => setCommandOpen(true)}
        />
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain px-4 pb-4 pt-4 sm:px-6 sm:pt-6 md:px-8 md:py-8 lg:pb-8">
          {children}
        </main>
        <MobileBottomNav />
      </div>

      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} profile={profile} />
      <AnnouncementGate userId={profile?.id ?? null} />
    </div>
  );
}
