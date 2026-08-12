"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Receipt,
  Users,
  UserPlus,
  Upload,
} from "lucide-react";
import { cn } from "@/utils/cn";

const items = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/receipts", label: "Receipts", icon: Receipt },
  { href: "/receipts/new", label: "Scan", icon: Upload, primary: true },
  { href: "/groups", label: "Groups", icon: Users },
  { href: "/friends", label: "Friends", icon: UserPlus },
];

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="relative z-40 shrink-0 border-t border-border bg-background/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl lg:hidden"
      aria-label="Primary"
    >
      <ul className="mx-auto flex max-w-lg items-end justify-between gap-1">
        {items.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/dashboard" &&
              item.href !== "/receipts/new" &&
              pathname.startsWith(item.href));

          if (item.primary) {
            return (
              <li key={item.href} className="-mt-5">
                <Link
                  href={item.href}
                  className="flex h-14 w-14 flex-col items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-[var(--glow)]"
                  aria-label={item.label}
                >
                  <item.icon className="h-5 w-5" />
                </Link>
              </li>
            );
          }

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                className={cn(
                  "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[10px] font-medium transition-colors",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <item.icon className="h-5 w-5" />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
