"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowRight, HandCoins, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  OwedToYouRow,
  PalOwedToYouRow,
  UnclaimedReceiptRow,
} from "@/hooks/use-dashboard";

function money(value: number, currency = "PHP") {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function titleCaseItem(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return name;
  if (trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) {
    return trimmed.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return trimmed;
}

export function ToCollectModal({
  collectTotal,
  groupOwedTotal,
  palOwedTotal,
  unclaimedItemCount,
  unclaimedItemValue,
  collectPendingCount,
  owedToYou,
  palOwedToYou,
  unclaimedReceipts,
  onClose,
}: {
  collectTotal: number;
  groupOwedTotal: number;
  palOwedTotal: number;
  unclaimedItemCount: number;
  unclaimedItemValue: number;
  collectPendingCount: number;
  owedToYou: OwedToYouRow[];
  palOwedToYou: PalOwedToYouRow[];
  unclaimedReceipts: UnclaimedReceiptRow[];
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const hasGroup = owedToYou.length > 0;
  const hasPal = palOwedToYou.length > 0;
  const hasUnclaimed = unclaimedReceipts.length > 0;
  const hasAny = hasGroup || hasPal || hasUnclaimed;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="to-collect-title"
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/65 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-border bg-background shadow-2xl sm:rounded-2xl"
        style={{ marginBottom: "max(0px, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-[1] border-b border-border bg-background px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="to-collect-title" className="text-base font-semibold">
                To collect
              </h2>
              <p className="text-xs text-muted-foreground">
                {collectPendingCount} unpaid & unclaimed
                {unclaimedItemCount > 0 && owedToYou.length + palOwedToYou.length > 0
                  ? ` (${owedToYou.length + palOwedToYou.length} people · ${unclaimedItemCount} item${unclaimedItemCount === 1 ? "" : "s"})`
                  : unclaimedItemCount > 0
                    ? ` · ${unclaimedItemCount} item${unclaimedItemCount === 1 ? "" : "s"} unassigned`
                    : ""}
              </p>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-10 w-10 shrink-0"
              aria-label="Close"
              onClick={onClose}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            <div className="rounded-xl border border-primary/25 bg-primary/10 px-2 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Unpaid
              </p>
              <p className="text-sm font-semibold tabular-nums text-primary">
                {money(collectTotal)}
              </p>
              {unclaimedItemValue > 0 ? (
                <p className="text-[10px] tabular-nums text-muted-foreground">
                  incl. ~{money(unclaimedItemValue)} unclaimed
                </p>
              ) : null}
            </div>
            <div className="rounded-xl border border-border bg-muted/30 px-2 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Groups
              </p>
              <p className="text-sm font-semibold tabular-nums">
                {money(groupOwedTotal)}
              </p>
            </div>
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-2 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Pals
              </p>
              <p className="text-sm font-semibold tabular-nums text-amber-700 dark:text-amber-300">
                {money(palOwedTotal)}
              </p>
            </div>
            <div className="rounded-xl border border-orange-500/25 bg-orange-500/10 px-2 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Unclaimed
              </p>
              <p className="text-sm font-semibold tabular-nums text-orange-700 dark:text-orange-300">
                {unclaimedItemCount}
              </p>
              {unclaimedItemValue > 0 ? (
                <p className="text-[10px] tabular-nums text-muted-foreground">
                  ~{money(unclaimedItemValue)}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="space-y-5 p-4">
          {!hasAny ? (
            <div className="py-10 text-center">
              <HandCoins className="mx-auto h-10 w-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm font-medium">All caught up</p>
              <p className="mt-1 text-xs text-muted-foreground">
                No unpaid splits, pal debts, or unclaimed items.
              </p>
            </div>
          ) : null}

          {hasUnclaimed ? (
            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Unclaimed items</h3>
                <span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-[10px] font-medium uppercase text-orange-800 dark:text-orange-200">
                  Not assigned
                </span>
              </div>
              <div className="space-y-3">
                {unclaimedReceipts.map((receipt) => (
                  <div
                    key={receipt.receiptId}
                    className="rounded-xl border border-orange-500/25 bg-orange-500/[0.04] p-3"
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {receipt.merchant ?? "Untitled receipt"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {receipt.groupName} · {receipt.itemCount} item
                          {receipt.itemCount === 1 ? "" : "s"}
                        </p>
                      </div>
                      <Button variant="ghost" size="sm" asChild className="h-8 shrink-0 px-2">
                        <Link href={`/receipts/${receipt.receiptId}`} onClick={onClose}>
                          View
                        </Link>
                      </Button>
                    </div>
                    <ul className="space-y-1.5">
                      {receipt.items.map((item) => (
                        <li
                          key={item.id}
                          className="flex items-baseline justify-between gap-2 text-xs"
                        >
                          <span className="min-w-0 truncate">
                            {titleCaseItem(item.name)}
                            <span className="ml-1 text-muted-foreground">· {item.label}</span>
                          </span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            ~{money(item.value, receipt.currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {hasGroup ? (
            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">From groups</h3>
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase text-amber-800 dark:text-amber-200">
                  Unpaid
                </span>
              </div>
              <ul className="divide-y divide-border rounded-xl border border-border">
                {owedToYou.map((row) => (
                  <li
                    key={`${row.memberId}-${row.userId ?? "guest"}`}
                    className="flex items-center justify-between gap-3 px-3 py-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{row.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.receiptCount} bill{row.receiptCount === 1 ? "" : "s"} · no
                        payment yet
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-semibold tabular-nums text-primary">
                        {money(row.amount, row.currency)}
                      </span>
                      {row.receiptIds[0] ? (
                        <Button variant="ghost" size="sm" asChild className="h-8 px-2">
                          <Link href={`/receipts/${row.receiptIds[0]}`} onClick={onClose}>
                            View
                          </Link>
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {hasPal ? (
            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Pal owes me</h3>
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase text-amber-800 dark:text-amber-200">
                  Unpaid
                </span>
              </div>
              <ul className="divide-y divide-border rounded-xl border border-amber-500/25 bg-amber-500/[0.04]">
                {palOwedToYou.map((row) => (
                  <li
                    key={row.debtorId}
                    className="flex items-center justify-between gap-3 px-3 py-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{row.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.debtCount} open record{row.debtCount === 1 ? "" : "s"}
                      </p>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                      {money(row.amount, row.currency)}
                    </span>
                  </li>
                ))}
              </ul>
              <Button variant="outline" size="sm" asChild className="mt-3 w-full sm:w-auto">
                <Link href="/pal-owes-me" onClick={onClose}>
                  Manage pal debts <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </section>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}
