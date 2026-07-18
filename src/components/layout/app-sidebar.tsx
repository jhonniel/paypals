"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Receipt,
  Users,
  UserPlus,
  Settings,
  Upload,
  BarChart3,
  Shield,
} from "lucide-react";
import { cn } from "@/utils/cn";
import type { Profile } from "@/types/database";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/receipts", label: "Receipts", icon: Receipt },
  { href: "/groups", label: "Groups", icon: Users },
  { href: "/friends", label: "Friends", icon: UserPlus },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppSidebar({
  onNavigate,
  profile,
}: {
  onNavigate?: () => void;
  profile?: Profile | null;
}) {
  const pathname = usePathname();
  const items = profile?.is_admin
    ? [...nav, { href: "/admin", label: "Admin", icon: Shield }]
    : nav;

  return (
    <aside className="flex h-full w-full flex-col bg-sidebar px-3 py-4 backdrop-blur-xl lg:border-r lg:border-border lg:py-5">
      <Link
        href="/dashboard"
        onClick={onNavigate}
        className="mb-6 hidden px-3 font-[family-name:var(--font-display)] text-2xl tracking-tight lg:mb-8 lg:block"
      >
        Paypals
      </Link>

      <Link
        href="/receipts/new"
        onClick={onNavigate}
        className="mb-6 flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground shadow-lg shadow-[var(--glow)] transition hover:brightness-110"
      >
        <Upload className="h-4 w-4" />
        Upload receipt
      </Link>

      <nav className="flex flex-1 flex-col gap-1">
        {items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
