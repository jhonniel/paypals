"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/utils/cn";

const WORD = "Paypals";
const ease = [0.22, 1, 0.36, 1] as const;

type BrandWordmarkProps = {
  href?: string | null;
  className?: string;
  /** Replay key — change to re-run the writing animation */
  replayKey?: string;
  onClick?: () => void;
  /** Larger hero treatment */
  size?: "sm" | "md" | "lg" | "hero";
};

const sizeClass: Record<NonNullable<BrandWordmarkProps["size"]>, string> = {
  sm: "text-xl tracking-tight",
  md: "text-2xl tracking-tight",
  lg: "text-3xl tracking-tight",
  hero: "text-[clamp(3rem,11vw,4.75rem)] leading-[1.12] tracking-tight",
};

/** Brand wordmark with a subtle fade-in reveal. */
export function BrandWordmark({
  href,
  className,
  replayKey = "brand",
  onClick,
  size = "md",
}: BrandWordmarkProps) {
  const reduceMotion = useReducedMotion();

  const content = (
    <motion.span
      key={replayKey}
      className={cn(
        "brand-wordmark relative inline-block overflow-visible font-[family-name:var(--font-display)]",
        sizeClass[size],
        size === "hero" && "pb-1",
        !href && className
      )}
      aria-label="Paypals"
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease }}
    >
      {WORD}
      {!reduceMotion ? (
        <motion.span
          className="brand-wordmark-ink pointer-events-none absolute bottom-0 left-0 h-[1.5px] origin-left rounded-full bg-current"
          aria-hidden
          initial={{ scaleX: 0, opacity: 0 }}
          animate={{ scaleX: 1, opacity: [0, 0.35, 0] }}
          transition={{
            duration: 1.05,
            ease,
            delay: 0.15,
            opacity: { times: [0, 0.55, 1], duration: 1.05 },
          }}
          style={{ width: "100%" }}
        />
      ) : null}
    </motion.span>
  );

  if (href) {
    return (
      <Link
        href={href}
        onClick={onClick}
        className={cn("inline-block overflow-visible", className)}
      >
        {content}
      </Link>
    );
  }

  return content;
}
