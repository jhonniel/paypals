"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/utils/cn";

/** Soft ease-out for nav reveal */
export const navEase = [0.22, 1, 0.36, 1] as const;

export const navListVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.08, delayChildren: 0.06 },
  },
};

export const navItemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: navEase },
  },
};

/**
 * Stroke-draws a Lucide icon line-by-line (smooth handwriting reveal).
 */
export function NavDrawIcon({
  icon: Icon,
  className,
  strokeWidth = 2,
  draw = true,
  drawKey,
  size = 20,
}: {
  icon: LucideIcon;
  className?: string;
  strokeWidth?: number;
  draw?: boolean;
  drawKey: string;
  size?: number;
}) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion || !draw) {
    return (
      <Icon
        className={cn("shrink-0", className)}
        style={{ width: size, height: size }}
        strokeWidth={strokeWidth}
      />
    );
  }

  return (
    <motion.span
      key={drawKey}
      className={cn(
        "nav-draw-icon inline-flex shrink-0 items-center justify-center",
        className
      )}
      style={{ width: size, height: size }}
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: navEase }}
    >
      <Icon
        style={{ width: size, height: size }}
        strokeWidth={strokeWidth}
        absoluteStrokeWidth
      />
    </motion.span>
  );
}
