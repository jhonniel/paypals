"use client";

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

const items = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/receipts", label: "Receipts", icon: Receipt },
  { href: "/receipts/new", label: "Scan", icon: Upload, primary: true },
  { href: "/groups", label: "Groups", icon: Users },
  { href: "/friends", label: "Friends", icon: UserPlus },
];

/** Ease-out expo — assemble / reveal */
const ease = [0.16, 1, 0.3, 1] as const;

const dockList = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.06, delayChildren: 0.04 },
  },
};

const dockSlot = {
  hidden: { opacity: 0, y: 18 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.52, ease },
  },
};

const assemble = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.09, delayChildren: 0.03 },
  },
};

const piece = {
  hidden: { opacity: 0, y: 12, scale: 0.86 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.42, ease },
  },
};

function TabContent({
  label,
  icon: Icon,
  active,
  assembleReveal,
}: {
  label: string;
  icon: (typeof items)[number]["icon"];
  active: boolean;
  assembleReveal: boolean;
}) {
  const reduceMotion = useReducedMotion();

  if (!assembleReveal || reduceMotion) {
    return (
      <span className="flex flex-col items-center gap-0.5">
        <Icon className="h-5 w-5" strokeWidth={active ? 2.35 : 2} />
        <span>{label}</span>
      </span>
    );
  }

  return (
    <motion.span
      key={`${label}-assemble`}
      className="flex flex-col items-center gap-0.5"
      variants={assemble}
      initial="hidden"
      animate="show"
    >
      <motion.span variants={piece} className="inline-flex" aria-hidden>
        <Icon className="h-5 w-5" strokeWidth={active ? 2.35 : 2} />
      </motion.span>
      <motion.span variants={piece} className="block">
        {label}
      </motion.span>
    </motion.span>
  );
}

export function MobileBottomNav() {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();

  return (
    <nav
      className="relative z-40 shrink-0 border-t border-border bg-background/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl lg:hidden"
      aria-label="Primary"
    >
      <motion.ul
        className="mx-auto flex max-w-lg items-end justify-between gap-1"
        variants={reduceMotion ? undefined : dockList}
        initial={reduceMotion ? false : "hidden"}
        animate="show"
      >
        {items.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/dashboard" &&
              item.href !== "/receipts/new" &&
              pathname.startsWith(item.href));

          if (item.primary) {
            return (
              <motion.li
                key={item.href}
                className="-mt-5"
                variants={reduceMotion ? undefined : dockSlot}
              >
                <motion.div
                  whileTap={
                    reduceMotion
                      ? undefined
                      : {
                          scale: 0.96,
                          transition: { duration: 0.15, ease },
                        }
                  }
                >
                  <Link
                    href={item.href}
                    className="flex h-14 w-14 flex-col items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-[var(--glow)]"
                    aria-label={item.label}
                  >
                    {reduceMotion ? (
                      <item.icon className="h-5 w-5" strokeWidth={2.25} />
                    ) : (
                      <motion.span
                        key={active ? "scan-on" : "scan"}
                        variants={assemble}
                        initial="hidden"
                        animate="show"
                        className="inline-flex"
                      >
                        <motion.span variants={piece} className="inline-flex">
                          <item.icon className="h-5 w-5" strokeWidth={2.25} />
                        </motion.span>
                      </motion.span>
                    )}
                  </Link>
                </motion.div>
              </motion.li>
            );
          }

          return (
            <motion.li
              key={item.href}
              className="relative flex-1"
              variants={reduceMotion ? undefined : dockSlot}
            >
              <motion.div
                whileTap={
                  reduceMotion
                    ? undefined
                    : {
                        scale: 0.97,
                        transition: { duration: 0.15, ease },
                      }
                }
              >
                <Link
                  href={item.href}
                  className={cn(
                    "relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[10px] font-medium",
                    active
                      ? "text-primary"
                      : "text-muted-foreground"
                  )}
                >
                  <TabContent
                    label={item.label}
                    icon={item.icon}
                    active={active}
                    assembleReveal={active}
                  />
                </Link>
              </motion.div>
            </motion.li>
          );
        })}
      </motion.ul>
    </nav>
  );
}
