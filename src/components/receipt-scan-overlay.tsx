"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/utils/cn";

const SCAN_STEPS = [
  "Detecting merchant…",
  "Locating line items…",
  "Reading prices…",
  "Parsing totals…",
  "Almost done…",
] as const;

export function ReceiptScanOverlay({
  active,
  previewUrl,
  className,
  compact = false,
}: {
  active: boolean;
  previewUrl?: string | null;
  className?: string;
  /** Smaller layout for card thumbnails */
  compact?: boolean;
}) {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!active) {
      setStepIndex(0);
      return;
    }
    const id = window.setInterval(() => {
      setStepIndex((i) => (i + 1) % SCAN_STEPS.length);
    }, 1600);
    return () => window.clearInterval(id);
  }, [active]);

  return (
    <AnimatePresence>
      {active ? (
        <motion.div
          key="receipt-scan"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className={cn(
            "absolute inset-0 z-20 flex flex-col items-center justify-center overflow-hidden",
            "bg-background/75 backdrop-blur-[2px]",
            className
          )}
          role="status"
          aria-live="polite"
          aria-label="Scanning receipt"
        >
          <div
            className={cn(
              "receipt-scan-frame relative overflow-hidden rounded-2xl border border-primary/35 bg-card shadow-[0_0_0_1px_color-mix(in_oklab,var(--primary)_20%,transparent),0_12px_40px_var(--glow)]",
              compact
                ? "h-40 w-[min(100%,14rem)]"
                : "h-[min(52vh,22rem)] w-[min(100%,16rem)] sm:h-[min(56vh,26rem)] sm:w-[min(100%,18rem)]"
            )}
          >
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt=""
                className="h-full w-full object-cover opacity-70"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-muted/40">
                <div className="h-3/4 w-3/5 rounded-sm border border-dashed border-muted-foreground/30 bg-background/40" />
              </div>
            )}

            {/* Soft vignette */}
            <div
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,color-mix(in_oklab,var(--background)_55%,transparent)_100%)]"
              aria-hidden
            />

            {/* Detection grid shimmer */}
            <div className="receipt-scan-grid pointer-events-none absolute inset-0 opacity-40" aria-hidden />

            {/* Moving laser beam */}
            <div className="receipt-scan-beam pointer-events-none absolute inset-x-0" aria-hidden>
              <div className="receipt-scan-beam-core" />
            </div>

            {/* Corner brackets */}
            <span className="receipt-scan-corner left-2 top-2 border-l-2 border-t-2" aria-hidden />
            <span className="receipt-scan-corner right-2 top-2 border-r-2 border-t-2" aria-hidden />
            <span className="receipt-scan-corner bottom-2 left-2 border-b-2 border-l-2" aria-hidden />
            <span className="receipt-scan-corner bottom-2 right-2 border-b-2 border-r-2" aria-hidden />

            {/* Floating detection ticks */}
            <motion.div
              className="pointer-events-none absolute left-[12%] top-[22%] h-1.5 w-1.5 rounded-full bg-primary"
              animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1.2, 0.8] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
              aria-hidden
            />
            <motion.div
              className="pointer-events-none absolute right-[18%] top-[48%] h-1.5 w-1.5 rounded-full bg-primary"
              animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1.2, 0.8] }}
              transition={{
                duration: 1.4,
                repeat: Infinity,
                ease: "easeInOut",
                delay: 0.45,
              }}
              aria-hidden
            />
            <motion.div
              className="pointer-events-none absolute left-[28%] bottom-[18%] h-1.5 w-1.5 rounded-full bg-primary"
              animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1.2, 0.8] }}
              transition={{
                duration: 1.4,
                repeat: Infinity,
                ease: "easeInOut",
                delay: 0.9,
              }}
              aria-hidden
            />
          </div>

          <div className={cn("mt-5 max-w-xs px-4 text-center", compact && "mt-3")}>
            <p className="text-sm font-semibold tracking-tight text-foreground">
              Scanning receipt
            </p>
            <AnimatePresence mode="wait">
              <motion.p
                key={SCAN_STEPS[stepIndex]}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.22 }}
                className="mt-1.5 text-xs text-muted-foreground sm:text-sm"
              >
                {SCAN_STEPS[stepIndex]}
              </motion.p>
            </AnimatePresence>

            <div className="mx-auto mt-3 flex h-1 w-36 overflow-hidden rounded-full bg-muted">
              <motion.div
                className="h-full rounded-full bg-primary"
                initial={{ width: "12%" }}
                animate={{ width: ["12%", "88%", "28%", "96%", "40%"] }}
                transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
              />
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
