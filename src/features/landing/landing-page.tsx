"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  QrCode,
  ScanLine,
  Shield,
  Split,
  Users,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

const HeroScene = dynamic(
  () => import("@/features/landing/hero-scene").then((m) => m.HeroScene),
  { ssr: false, loading: () => <div className="h-full w-full bg-transparent" /> }
);

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" as const },
  transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
};

function SampleBill() {
  return (
    <div className="landing-receipt w-full max-w-sm rounded-2xl border border-border px-6 py-6 sm:px-7 sm:py-7">
      <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Sample split
          </p>
          <p className="mt-1 font-[family-name:var(--font-display)] text-2xl tracking-tight">
            Weekend brunch
          </p>
        </div>
        <p className="text-sm font-semibold tabular-nums text-primary">₱2,180</p>
      </div>
      <ul className="mt-4 space-y-3 text-sm">
        {[
          ["Pancake stack", "You", "₱420"],
          ["Matcha latte ×2", "You · Friend", "₱360"],
          ["Family platter", "Shared ×4", "₱980"],
          ["Service + tip", "Pro‑rata", "₱420"],
        ].map(([item, who, amt]) => (
          <li key={item} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">{item}</p>
              <p className="text-xs text-muted-foreground">{who}</p>
            </div>
            <span className="shrink-0 tabular-nums text-muted-foreground">{amt}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5 space-y-2 border-t border-border pt-4 text-sm">
        <div className="flex justify-between text-muted-foreground">
          <span>Your total</span>
          <span className="tabular-nums">₱745</span>
        </div>
        <div className="flex justify-between font-semibold">
          <span>Ready to settle</span>
          <span className="tabular-nums text-primary">₱745</span>
        </div>
      </div>
    </div>
  );
}

export function LandingPage() {
  return (
    <div className="min-h-dvh overflow-x-hidden bg-background text-foreground">
      {/* Header */}
      <header className="absolute inset-x-0 top-0 z-30 border-b border-transparent">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6 md:px-8 md:py-4">
          <Link
            href="/"
            className="font-[family-name:var(--font-display)] text-xl tracking-tight sm:text-2xl"
          >
            Paypals
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-muted-foreground lg:flex">
            <a href="#problem" className="hover:text-foreground">
              Why Paypals
            </a>
            <a href="#how" className="hover:text-foreground">
              How it works
            </a>
            <a href="#features" className="hover:text-foreground">
              Features
            </a>
          </nav>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <ThemeToggle compact />
            <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/signup">Get started</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="landing-hero-atmosphere relative min-h-[100dvh] overflow-hidden">
        <div className="landing-grid pointer-events-none absolute inset-0 opacity-60" />
        <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-1/2 lg:block">
          <HeroScene />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/20 via-transparent to-background lg:bg-gradient-to-r lg:from-background lg:via-background/85 lg:to-transparent" />

        <div className="relative z-10 mx-auto grid min-h-[100dvh] max-w-6xl items-center gap-10 px-4 pb-16 pt-28 sm:px-6 md:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8 lg:pb-20 lg:pt-24">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-xl"
          >
            <p className="font-[family-name:var(--font-display)] text-[clamp(3rem,11vw,4.75rem)] leading-[0.92] tracking-tight">
              Paypals
            </p>
            <h1 className="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">
              Split every receipt — fairly, fast, in pesos.
            </h1>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
              Scan a bill, assign what everyone ordered, and settle the total without
              spreadsheets, group chats, or awkward calculations.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button size="lg" asChild>
                <Link href="/signup">
                  Create account <ArrowRight />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/login">Sign in</Link>
              </Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground sm:text-sm">
              Invite-only access · Works with camera, PDF, and HEIC · Default currency PHP
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.75, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
            className="relative flex justify-center lg:justify-end"
          >
            <div className="absolute -inset-10 -z-10 rounded-full bg-primary/15 blur-3xl" />
            <SampleBill />
          </motion.div>
        </div>
      </section>

      {/* Problem / need */}
      <section id="problem" className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24 md:px-8">
          <motion.div {...fadeUp} className="max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
              The problem
            </p>
            <h2 className="mt-3 font-[family-name:var(--font-display)] text-3xl tracking-tight sm:text-4xl md:text-5xl">
              Shared bills should not end in confusion.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              After dinner, someone photographs the receipt, someone else does the math, and
              half the table still asks “how much do I owe?” Paypals turns that mess into a
              clear share for every person.
            </p>
          </motion.div>

          <div className="mt-12 grid gap-8 sm:grid-cols-3">
            {[
              {
                title: "Uneven orders",
                body: "Not everyone ordered the same thing — equal split is unfair.",
              },
              {
                title: "Tax & tip chaos",
                body: "Service charge and tip get forgotten or applied unevenly.",
              },
              {
                title: "No shared view",
                body: "Screenshots and chats go stale the moment the bill changes.",
              },
            ].map((item, i) => (
              <motion.div
                key={item.title}
                {...fadeUp}
                transition={{ ...fadeUp.transition, delay: i * 0.07 }}
                className="border-t border-border pt-5"
              >
                <h3 className="text-lg font-semibold tracking-tight">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {item.body}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-t border-border bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24 md:px-8">
          <motion.div {...fadeUp} className="max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
              How it works
            </p>
            <h2 className="mt-3 font-[family-name:var(--font-display)] text-3xl tracking-tight sm:text-4xl md:text-5xl">
              Three steps from receipt to settled.
            </h2>
          </motion.div>

          <ol className="mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
            {[
              {
                n: "1",
                icon: ScanLine,
                title: "Upload or scan",
                body: "Take a photo, upload a PDF, or paste from clipboard. OCR extracts items, tax, and tip so you can edit anything that looks off.",
              },
              {
                n: "2",
                icon: Users,
                title: "Assign to people",
                body: "Add your group or guests. Split by equal share, percentage, quantity, or exact amounts — including shared plates.",
              },
              {
                n: "3",
                icon: Wallet,
                title: "See who pays what",
                body: "Everyone gets a clear peso total. Tax, tip, and discounts are allocated automatically. Settle without the guesswork.",
              },
            ].map((step, i) => (
              <motion.li
                key={step.n}
                {...fadeUp}
                transition={{ ...fadeUp.transition, delay: i * 0.08 }}
                className="flex flex-col"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
                  <step.icon className="h-5 w-5" />
                </div>
                <p className="mt-5 text-xs font-medium uppercase tracking-[0.18em] text-primary">
                  Step {step.n}
                </p>
                <h3 className="mt-2 text-xl font-semibold tracking-tight">{step.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </motion.li>
            ))}
          </ol>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24 md:px-8">
          <motion.div {...fadeUp} className="max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
              What you get
            </p>
            <h2 className="mt-3 font-[family-name:var(--font-display)] text-3xl tracking-tight sm:text-4xl md:text-5xl">
              Everything a real group needs to split bills.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Built for Philippine dinners and trips first — PHP by default, invite links,
              and live updates while people decide.
            </p>
          </motion.div>

          <div className="mt-14 grid gap-x-12 gap-y-10 sm:grid-cols-2">
            {[
              {
                icon: Split,
                title: "Flexible split methods",
                body: "Equal, percentage, quantity, weighted, or custom peso amounts per item.",
              },
              {
                icon: QrCode,
                title: "Group invites & QR",
                body: "Share a link or QR code. Friends join in seconds; guests can be added by name.",
              },
              {
                icon: Shield,
                title: "Invite-only accounts",
                body: "Signup requires a valid invite code so your groups stay intentional.",
              },
              {
                icon: Wallet,
                title: "Accurate money math",
                body: "Decimal-safe totals for tax, tip, service charge, and discounts — no float errors.",
              },
            ].map((f, i) => (
              <motion.div
                key={f.title}
                {...fadeUp}
                transition={{ ...fadeUp.transition, delay: i * 0.06 }}
                className="flex gap-4 border-t border-border pt-6"
              >
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                  <f.icon className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-base font-semibold tracking-tight">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {f.body}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>

          <motion.ul
            {...fadeUp}
            className="mt-14 grid gap-3 border-t border-border pt-10 sm:grid-cols-2 lg:grid-cols-3"
          >
            {[
              "Camera, gallery, clipboard & PDF upload",
              "HEIC support for iPhone photos",
              "Editable OCR results before you finalize",
              "Realtime assignment updates",
              "Friends list & notifications",
              "Export your data anytime",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>{item}</span>
              </li>
            ))}
          </motion.ul>
        </div>
      </section>

      {/* Who it's for */}
      <section className="border-t border-border bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24 md:px-8">
          <motion.div {...fadeUp} className="max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
              Made for
            </p>
            <h2 className="mt-3 font-[family-name:var(--font-display)] text-3xl tracking-tight sm:text-4xl">
              Friend groups, housemates, and travel crews.
            </h2>
          </motion.div>
          <div className="mt-12 grid gap-8 sm:grid-cols-3">
            {[
              {
                title: "Dinner out",
                body: "One receipt, many orders — everyone pays only for what they ate.",
              },
              {
                title: "Trips & stays",
                body: "Groceries, Grab, and hotel extras tracked in one shared group.",
              },
              {
                title: "House shares",
                body: "Split utilities or takeout with the same people every week.",
              },
            ].map((item, i) => (
              <motion.div
                key={item.title}
                {...fadeUp}
                transition={{ ...fadeUp.transition, delay: i * 0.07 }}
                className="border-t border-border pt-5"
              >
                <h3 className="text-lg font-semibold tracking-tight">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {item.body}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24 md:px-8">
          <motion.div
            {...fadeUp}
            className="landing-hero-atmosphere relative overflow-hidden rounded-3xl border border-border px-6 py-12 sm:px-10 sm:py-14 md:px-14"
          >
            <div className="landing-grid pointer-events-none absolute inset-0 opacity-40" />
            <div className="relative max-w-xl">
              <h2 className="font-[family-name:var(--font-display)] text-3xl tracking-tight sm:text-4xl md:text-5xl">
                Ready to split the next bill cleanly?
              </h2>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                You’ll need an invite code to join. Ask a friend who’s already on Paypals,
                or use a group invite link from your host.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button size="lg" asChild>
                  <Link href="/signup">
                    Sign up with invite <ArrowRight />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link href="/login">I have an account</Link>
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <footer className="border-t border-border px-4 py-10 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-6 md:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-[family-name:var(--font-display)] text-xl tracking-tight">
              Paypals
            </p>
            <p className="mt-2 max-w-xs text-sm text-muted-foreground">
              AI receipt splitter for friends who want fair shares — fast.
            </p>
          </div>
          <div className="flex gap-12 text-sm">
            <div className="space-y-2">
              <p className="font-medium">Explore</p>
              <a href="#how" className="block text-muted-foreground hover:text-foreground">
                How it works
              </a>
              <a
                href="#features"
                className="block text-muted-foreground hover:text-foreground"
              >
                Features
              </a>
            </div>
            <div className="space-y-2">
              <p className="font-medium">Account</p>
              <Link href="/login" className="block text-muted-foreground hover:text-foreground">
                Sign in
              </Link>
              <Link
                href="/signup"
                className="block text-muted-foreground hover:text-foreground"
              >
                Sign up
              </Link>
            </div>
          </div>
        </div>
        <p className="mx-auto mt-10 max-w-6xl border-t border-border pt-6 text-xs text-muted-foreground">
          © {new Date().getFullYear()} Paypals · Made by JRY
        </p>
      </footer>
    </div>
  );
}
