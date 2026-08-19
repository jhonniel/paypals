"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowRight, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ItemBreakdownList } from "@/components/item-breakdown-list";
import type { GroupPayableRow } from "@/hooks/use-dashboard";

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

export function GroupPayableModal({
  totalOwes,
  currency,
  groups,
  onClose,
}: {
  totalOwes: number;
  currency: string;
  groups: GroupPayableRow[];
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const hasAny = groups.length > 0;

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
      aria-labelledby="group-payable-title"
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
              <h2 id="group-payable-title" className="text-base font-semibold">
                Group payables
              </h2>
              <p className="text-xs text-muted-foreground">
                {hasAny
                  ? `${groups.length} group${groups.length === 1 ? "" : "s"} · unpaid share`
                  : "Nothing due in your groups"}
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

          <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Total to pay
            </p>
            <p className="text-lg font-semibold tabular-nums text-amber-700 dark:text-amber-300">
              {money(totalOwes, currency)}
            </p>
          </div>
        </div>

        <div className="space-y-5 p-4">
          {!hasAny ? (
            <div className="py-10 text-center">
              <Users className="mx-auto h-10 w-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm font-medium">All caught up</p>
              <p className="mt-1 text-xs text-muted-foreground">
                No unpaid group balances right now.
              </p>
            </div>
          ) : (
            <ul className="space-y-4">
              {groups.map((group) => {
                const itemCount = group.receipts.reduce(
                  (total, receipt) => total + receipt.items.length,
                  0
                );

                return (
                  <li
                    key={group.groupId}
                    className="rounded-xl border border-amber-500/25 bg-amber-500/[0.04] p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{group.groupName}</p>
                        <p className="text-xs text-muted-foreground">
                          Your share {money(group.share, group.currency)}
                          {itemCount > 0
                            ? ` · ${itemCount} item${itemCount === 1 ? "" : "s"}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="font-semibold tabular-nums text-amber-700 dark:text-amber-300">
                          {money(group.owes, group.currency)}
                        </span>
                        <Button variant="ghost" size="sm" asChild className="h-8 px-2">
                          <Link href={`/groups/${group.groupId}`} onClick={onClose}>
                            Pay <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                      </div>
                    </div>

                    {group.receipts.length > 0 ? (
                      <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
                        {group.receipts.map((receipt) => (
                          <div key={receipt.receipt_id}>
                            <div className="mb-1.5 flex items-baseline justify-between gap-2">
                              <p className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                {receipt.merchant ?? "Untitled receipt"}
                                {receipt.receipt_date ? ` · ${receipt.receipt_date}` : ""}
                              </p>
                              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                                {money(receipt.amount, receipt.currency)}
                              </span>
                            </div>
                            <ItemBreakdownList
                              items={receipt.items}
                              currency={receipt.currency}
                              dense
                              titleCase={titleCaseItem}
                            />
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {hasAny ? (
            <Button variant="outline" size="sm" asChild className="w-full sm:w-auto">
              <Link href="/groups" onClick={onClose}>
                View all groups <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}
