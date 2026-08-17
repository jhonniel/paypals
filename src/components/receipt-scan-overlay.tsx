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
  subtitle,
  scanKey,
}: {
  active: boolean;
  previewUrl?: string | null;
  className?: string;
  /** Smaller layout for card thumbnails */
  compact?: boolean;
  /** e.g. "Receipt 2 of 5" during batch uploads */
  subtitle?: string | null;
  /** Changes when a new file starts scanning — resets step progress */
  scanKey?: string | number | null;
}) {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!active) {
      setStepIndex(0);
      return;
    }
    setStepIndex(0);
    const id = window.setInterval(() => {
      setStepIndex((i) => Math.min(i + 1, SCAN_STEPS.length - 1));
    }, 2000);
    return () => window.clearInterval(id);
  }, [active, scanKey]);

  const progressPct = Math.min(
    8 + ((stepIndex + 1) / SCAN_STEPS.length) * 85,
    93
  );

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
            "absolute inset-0 z-20 flex flex-col overflow-hidden",
            compact
              ? "bg-background/60 backdrop-blur-[1px]"
              : "bg-background/80 backdrop-blur-[2px]",
            className
          )}
          role="status"
          aria-live="polite"
          aria-label="Scanning receipt"
        >
          {/* Image + scan effects fill the whole overlay */}
          <div className="relative min-h-0 flex-1">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-contain opacity-80"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-muted/30 p-8">
                <div className="h-full max-h-64 w-full max-w-xs rounded-lg border border-dashed border-muted-foreground/30 bg-background/40" />
              </div>
            )}

            {/* Scan effects — cover full image area, no fixed hotspots */}
            <div className="pointer-events-none absolute inset-0" aria-hidden>
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,color-mix(in_oklab,var(--background)_50%,transparent)_100%)]" />
              <div className="receipt-scan-grid absolute inset-0 opacity-35" />
              <div className="receipt-scan-sweep absolute inset-0" />
              <div className="receipt-scan-beam absolute inset-x-0">
                <div className="receipt-scan-beam-core" />
              </div>
              <span className="receipt-scan-corner left-3 top-3 border-l-2 border-t-2 sm:left-4 sm:top-4" />
              <span className="receipt-scan-corner right-3 top-3 border-r-2 border-t-2 sm:right-4 sm:top-4" />
              <span className="receipt-scan-corner bottom-3 left-3 border-b-2 border-l-2 sm:bottom-4 sm:left-4" />
              <span className="receipt-scan-corner bottom-3 right-3 border-b-2 border-r-2 sm:bottom-4 sm:right-4" />
            </div>
          </div>

          <div
            className={cn(
              "shrink-0 border-t border-border/60 bg-background/90 px-4 py-3 text-center backdrop-blur-sm",
              compact && "py-2"
            )}
          >
            <p
              className={cn(
                "font-semibold tracking-tight text-foreground",
                compact ? "text-xs" : "text-sm"
              )}
            >
              Scanning receipt
            </p>
            {subtitle ? (
              <p
                className={cn(
                  "mt-0.5 text-muted-foreground",
                  compact ? "text-[10px]" : "text-xs"
                )}
              >
                {subtitle}
              </p>
            ) : null}
            <AnimatePresence mode="wait">
              <motion.p
                key={SCAN_STEPS[stepIndex]}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.22 }}
                className={cn(
                  "mt-1 text-muted-foreground",
                  compact ? "text-[10px]" : "text-xs sm:text-sm"
                )}
              >
                {SCAN_STEPS[stepIndex]}
              </motion.p>
            </AnimatePresence>

            <div
              className={cn(
                "mx-auto mt-2 flex h-1 overflow-hidden rounded-full bg-muted",
                compact ? "w-24" : "w-36"
              )}
            >
              <motion.div
                className="h-full rounded-full bg-primary"
                initial={false}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.45, ease: "easeOut" }}
              />
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
