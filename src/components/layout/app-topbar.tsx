"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, User, Settings, Menu, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationsBell } from "@/features/notifications/notifications-bell";
import type { Profile } from "@/types/database";

export function AppTopbar({
  profile,
  onMenuClick,
  onSearchClick,
}: {
  profile: Profile | null;
  onMenuClick?: () => void;
  onSearchClick?: () => void;
}) {
  const router = useRouter();
  const initials =
    profile?.full_name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() ||
    profile?.email?.[0]?.toUpperCase() ||
    "P";

  async function signOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* best effort */
    }
    toast.success("Signed out");
    router.push("/");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/80 px-3 pt-[env(safe-area-inset-top)] backdrop-blur-xl sm:h-16 sm:gap-3 sm:px-4 md:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 lg:hidden"
        onClick={onMenuClick}
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </Button>

      <Link
        href="/dashboard"
        className="shrink-0 font-[family-name:var(--font-display)] text-xl tracking-tight lg:hidden"
      >
        Paypals
      </Link>

      <button
        type="button"
        onClick={onSearchClick}
        className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 text-sm text-muted-foreground transition hover:bg-muted/70 md:max-w-md"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="truncate">Search…</span>
        <kbd className="ml-auto hidden rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium md:inline">
          ⌘K
        </kbd>
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
        <NotificationsBell userId={profile?.id ?? null} />
        <ThemeToggle compact />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="relative h-10 w-10 rounded-full p-0"
              aria-label="Account menu"
            >
              <Avatar className="h-9 w-9">
                <AvatarImage src={profile?.avatar_url ?? undefined} alt="" />
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col space-y-0.5">
                <span className="font-medium">{profile?.full_name ?? "Account"}</span>
                <span className="truncate text-xs font-normal text-muted-foreground">
                  {profile?.email}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/profile">
                <User className="mr-2 h-4 w-4" /> Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings">
                <Settings className="mr-2 h-4 w-4" /> Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut}>
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
