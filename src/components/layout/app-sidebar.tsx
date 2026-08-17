"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  LayoutDashboard,
  Receipt,
  Users,
  UserPlus,
  HandCoins,
  Settings,
  Upload,
  BarChart3,
  Shield,
} from "lucide-react";
import { cn } from "@/utils/cn";
import type { Profile } from "@/types/database";
import {
  NavDrawIcon,
  navEase,
  navItemVariants,
  navListVariants,
} from "@/components/layout/nav-draw-icon";
import { isNavItemActive } from "@/components/layout/nav-active";
import { BrandWordmark } from "@/components/brand-wordmark";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/receipts", label: "Receipts", icon: Receipt },
  { href: "/groups", label: "Groups", icon: Users },
  { href: "/friends", label: "Friends", icon: UserPlus },
  { href: "/pal-owes-me", label: "Pal owes me", icon: HandCoins },
  { href: "/settings", label: "Settings", icon: Settings },
];

const adminNav = [
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/admin", label: "Admin", icon: Shield },
];

export function AppSidebar({
  onNavigate,
  profile,
}: {
  onNavigate?: () => void;
  profile?: Profile | null;
}) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const [boot, setBoot] = useState(true);
  const items = profile?.is_admin ? [...nav, ...adminNav] : nav;

  useEffect(() => {
    const t = window.setTimeout(() => setBoot(false), 1500);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <aside className="flex h-full w-full flex-col bg-sidebar px-3 py-4 backdrop-blur-xl lg:border-r lg:border-border lg:py-5">
      <BrandWordmark
        href="/dashboard"
        onClick={onNavigate}
        size="md"
        className="mb-6 hidden px-3 lg:mb-8 lg:inline-flex"
        replayKey="sidebar-brand"
      />

      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: navEase }}
      >
        <Link
          href="/receipts/new"
          onClick={onNavigate}
          className="mb-6 flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground shadow-lg shadow-[var(--glow)] transition hover:brightness-110"
        >
          <NavDrawIcon
            icon={Upload}
            size={16}
            strokeWidth={2.25}
            draw={boot || pathname.startsWith("/receipts/new")}
            drawKey={
              boot
                ? "upload-boot"
                : pathname.startsWith("/receipts/new")
                  ? "upload-active"
                  : "upload-idle"
            }
          />
          Upload receipt
        </Link>
      </motion.div>

      <motion.nav
        className="flex flex-1 flex-col gap-1"
        variants={reduceMotion ? undefined : navListVariants}
        initial={reduceMotion ? false : "hidden"}
        animate="show"
      >
        {items.map((item) => {
          const active = isNavItemActive(pathname, item.href);
          const shouldDraw = boot || active;
          const drawKey = boot
            ? `${item.href}-boot`
            : active
              ? `${item.href}-active`
              : `${item.href}-idle`;

          return (
            <motion.div
              key={item.href}
              variants={reduceMotion ? undefined : navItemVariants}
              whileHover={
                reduceMotion
                  ? undefined
                  : {
                      x: 2,
                      transition: { duration: 0.22, ease: navEase },
                    }
              }
              whileTap={
                reduceMotion
                  ? undefined
                  : {
                      scale: 0.98,
                      transition: { duration: 0.14, ease: navEase },
                    }
              }
            >
              <Link
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-300",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                <NavDrawIcon
                  icon={item.icon}
                  size={16}
                  strokeWidth={active ? 2.35 : 2}
                  draw={shouldDraw}
                  drawKey={drawKey}
                />
                {item.label}
              </Link>
            </motion.div>
          );
        })}
      </motion.nav>
    </aside>
  );
}
