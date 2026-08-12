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
  hero: "text-[clamp(3rem,11vw,4.75rem)] leading-[0.92] tracking-tight",
};

/**
 * Brand wordmark with a cursive-style writing reveal
 * (letters ink in left-to-right like a pen stroke).
 */
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
        "brand-wordmark relative inline-flex font-[family-name:var(--font-display)]",
        sizeClass[size],
        !href && className
      )}
      aria-label="Paypals"
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: {
          transition: {
            staggerChildren: reduceMotion ? 0 : 0.055,
            delayChildren: reduceMotion ? 0 : 0.08,
          },
        },
      }}
    >
      {WORD.split("").map((char, i) => (
        <motion.span
          key={`${char}-${i}`}
          className="brand-wordmark-letter relative inline-block"
          variants={
            reduceMotion
              ? undefined
              : {
                  hidden: {
                    opacity: 0,
                    y: 6,
                    clipPath: "inset(0 100% 0 0)",
                  },
                  show: {
                    opacity: 1,
                    y: 0,
                    clipPath: "inset(0 0% 0 0)",
                    transition: {
                      duration: 0.42,
                      ease,
                    },
                  },
                }
          }
          style={{ whiteSpace: "pre" }}
        >
          {char}
        </motion.span>
      ))}
      {!reduceMotion ? (
        <motion.span
          className="brand-wordmark-ink pointer-events-none absolute -bottom-0.5 left-0 h-[1.5px] origin-left rounded-full bg-current"
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
        className={cn("inline-flex", className)}
      >
        {content}
      </Link>
    );
  }

  return content;
}
