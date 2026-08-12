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
  Upload,
} from "lucide-react";
import { cn } from "@/utils/cn";
import {
  NavDrawIcon,
  navEase,
  navItemVariants,
  navListVariants,
} from "@/components/layout/nav-draw-icon";
import { useMobileKeyboardOpen } from "@/hooks/use-mobile-keyboard";

const items = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/receipts", label: "Receipts", icon: Receipt },
  { href: "/receipts/new", label: "Scan", icon: Upload, primary: true },
  { href: "/groups", label: "Groups", icon: Users },
  { href: "/friends", label: "Friends", icon: UserPlus },
];

export function MobileBottomNav() {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const [boot, setBoot] = useState(true);
  const keyboardOpen = useMobileKeyboardOpen();

  useEffect(() => {
    const t = window.setTimeout(() => setBoot(false), 1400);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <nav
      className={cn(
        "relative z-40 shrink-0 overflow-hidden border-t border-border bg-background/95 backdrop-blur-xl transition-[max-height,opacity,padding,border-color] duration-200 ease-out lg:hidden",
        keyboardOpen
          ? "pointer-events-none max-h-0 border-transparent opacity-0 py-0"
          : "max-h-28 opacity-100 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2"
      )}
      aria-label="Primary"
      aria-hidden={keyboardOpen}
    >
      <motion.ul
        className="mx-auto flex max-w-lg items-end justify-between gap-1"
        variants={reduceMotion ? undefined : navListVariants}
        initial={reduceMotion ? false : "hidden"}
        animate="show"
      >
        {items.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/dashboard" &&
              item.href !== "/receipts/new" &&
              pathname.startsWith(item.href));

          const shouldDraw = boot || active;
          const drawKey = boot
            ? `${item.href}-boot`
            : active
              ? `${item.href}-active`
              : `${item.href}-idle`;

          if (item.primary) {
            return (
              <motion.li
                key={item.href}
                className="-mt-5"
                variants={reduceMotion ? undefined : navItemVariants}
              >
                <motion.div
                  whileTap={
                    reduceMotion
                      ? undefined
                      : {
                          scale: 0.96,
                          transition: { duration: 0.16, ease: navEase },
                        }
                  }
                  whileHover={
                    reduceMotion
                      ? undefined
                      : {
                          scale: 1.03,
                          transition: { duration: 0.22, ease: navEase },
                        }
                  }
                >
                  <Link
                    href={item.href}
                    className="flex h-14 w-14 flex-col items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-[var(--glow)]"
                    aria-label={item.label}
                  >
                    <NavDrawIcon
                      icon={item.icon}
                      size={20}
                      strokeWidth={2.25}
                      draw={shouldDraw}
                      drawKey={drawKey}
                    />
                  </Link>
                </motion.div>
              </motion.li>
            );
          }

          return (
            <motion.li
              key={item.href}
              className="relative flex-1"
              variants={reduceMotion ? undefined : navItemVariants}
            >
              <motion.div
                whileTap={
                  reduceMotion
                    ? undefined
                    : {
                        scale: 0.97,
                        transition: { duration: 0.16, ease: navEase },
                      }
                }
              >
                <Link
                  href={item.href}
                  className={cn(
                    "relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[10px] font-medium transition-colors duration-300",
                    active
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <NavDrawIcon
                    icon={item.icon}
                    size={20}
                    strokeWidth={active ? 2.35 : 2}
                    draw={shouldDraw}
                    drawKey={drawKey}
                  />
                  <span>{item.label}</span>
                </Link>
              </motion.div>
            </motion.li>
          );
        })}
      </motion.ul>
    </nav>
  );
}
