"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, ScanLine, Users, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

const HeroScene = dynamic(
  () => import("@/features/landing/hero-scene").then((m) => m.HeroScene),
  { ssr: false, loading: () => null }
);

const steps = [
  {
    icon: ScanLine,
    title: "Scan any receipt",
    body: "Upload a photo or PDF. OCR extracts every line item with confidence scores.",
  },
  {
    icon: Users,
    title: "Assign with friends",
    body: "Share equally, by percentage, or pick who ordered what — live and instant.",
  },
  {
    icon: Sparkles,
    title: "Settle cleanly",
    body: "Get a payment summary everyone understands. No spreadsheets. No awkward math.",
  },
];

export function LandingPage() {
  return (
    <div className="min-h-dvh overflow-x-hidden bg-background text-foreground">
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 md:px-10 md:py-5">
        <Link
          href="/"
          className="font-[family-name:var(--font-display)] text-2xl tracking-tight sm:text-3xl md:text-4xl"
        >
          Paypals
        </Link>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <ThemeToggle compact />
          <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button size="sm" asChild className="sm:h-10 sm:px-4 sm:text-sm">
            <Link href="/signup">
              <span className="sm:hidden">Start</span>
              <span className="hidden sm:inline">Get started</span>
              <ArrowRight className="hidden sm:inline" />
            </Link>
          </Button>
        </div>
      </header>

      <section className="gradient-mesh relative flex min-h-dvh flex-col justify-end overflow-hidden px-4 pb-16 pt-28 sm:px-6 md:justify-center md:px-10 md:pb-24 md:pt-24">
        {/* 3D only on md+ — keeps mobile fast & avoids WebGL glitches */}
        <div className="pointer-events-none absolute inset-0 hidden md:block">
          <HeroScene />
        </div>
        <div
          className="pointer-events-none absolute inset-x-0 top-24 mx-auto h-48 w-48 animate-float rounded-[2rem] border border-border/60 bg-card/40 shadow-2xl backdrop-blur-md md:hidden"
          aria-hidden
        >
          <div className="space-y-2 p-6">
            <div className="h-2 w-16 rounded bg-primary/70" />
            <div className="h-1.5 w-full rounded bg-muted-foreground/20" />
            <div className="h-1.5 w-5/6 rounded bg-muted-foreground/20" />
            <div className="h-1.5 w-4/6 rounded bg-muted-foreground/20" />
            <div className="mt-4 h-3 w-20 rounded bg-primary/50" />
          </div>
        </div>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-background/55 to-transparent md:bg-gradient-to-r md:from-background md:via-background/70 md:to-transparent" />

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 w-full max-w-xl"
        >
          <h1 className="font-[family-name:var(--font-display)] text-[2.65rem] leading-[1.05] tracking-tight sm:text-5xl md:text-7xl">
            Split every bill.
            <span className="block text-primary">Beautifully.</span>
          </h1>
          <p className="mt-4 max-w-md text-sm text-muted-foreground sm:mt-5 sm:text-base md:text-lg">
            AI reads the receipt. Friends claim their items. Everyone pays the right amount —
            instantly.
          </p>
          <div className="mt-7 flex w-full flex-col gap-3 sm:mt-8 sm:flex-row sm:flex-wrap sm:items-center">
            <Button size="lg" className="w-full sm:w-auto" asChild>
              <Link href="/signup">
                Start free <ArrowRight />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="w-full sm:w-auto" asChild>
              <Link href="/login">I have an account</Link>
            </Button>
          </div>
        </motion.div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24 md:px-10">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
          className="max-w-2xl"
        >
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary sm:text-sm">
            How it works
          </p>
          <h2 className="mt-3 font-[family-name:var(--font-display)] text-3xl tracking-tight sm:text-4xl md:text-5xl">
            From photo to fair split in three beats.
          </h2>
        </motion.div>
        <div className="mt-10 grid gap-8 sm:mt-14 sm:gap-10 md:grid-cols-3">
          {steps.map((step, i) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.45, delay: i * 0.08 }}
              className="space-y-3 sm:space-y-4"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
                <step.icon className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-semibold tracking-tight">{step.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="px-4 pb-20 sm:px-6 sm:pb-24 md:px-10">
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="glass mx-auto flex max-w-6xl flex-col items-stretch gap-6 rounded-[1.5rem] px-6 py-10 sm:items-start sm:gap-8 sm:rounded-[2rem] sm:px-8 sm:py-12 md:flex-row md:items-center md:px-14"
        >
          <div className="flex-1">
            <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight sm:text-3xl md:text-4xl">
              Ready for the next dinner?
            </h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground sm:text-base">
              Join Paypals and turn messy receipts into crystal-clear shares.
            </p>
          </div>
          <Button size="lg" className="w-full shrink-0 md:w-auto" asChild>
            <Link href="/signup">
              Create account <ArrowRight />
            </Link>
          </Button>
        </motion.div>
      </section>

      <footer className="border-t border-border px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] text-sm text-muted-foreground sm:px-6 md:px-10">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="font-[family-name:var(--font-display)] text-lg text-foreground">
            Paypals
          </span>
          <p>© {new Date().getFullYear()} Paypals. Split fairly.</p>
        </div>
      </footer>
    </div>
  );
}
