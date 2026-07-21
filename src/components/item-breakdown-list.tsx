"use client";

import { cn } from "@/lib/utils";
import type { ReceiptSubItem } from "@/lib/receipt-sub-items";

function money(value: number, currency = "PHP") {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export type BreakdownItem = {
  name: string;
  quantity?: number;
  amount: number;
  sub_items?: ReceiptSubItem[];
};

export function ItemBreakdownList({
  items,
  currency = "PHP",
  dense = false,
  titleCase,
}: {
  items: BreakdownItem[];
  currency?: string;
  dense?: boolean;
  titleCase?: (name: string) => string;
}) {
  const label = (name: string) => (titleCase ? titleCase(name) : name);

  return (
    <ul className={cn(dense ? "space-y-1" : "space-y-1.5")}>
      {items.map((item, idx) => {
        const subs = item.sub_items ?? [];
        return (
          <li key={`${item.name}-${idx}`} className="min-w-0">
            <div
              className={cn(
                "flex items-baseline justify-between gap-2",
                dense ? "text-[10px] sm:text-xs" : "text-xs sm:text-sm"
              )}
            >
              <span className="min-w-0 truncate text-muted-foreground">
                {label(item.name)}
                {(item.quantity ?? 1) > 1 ? ` ×${item.quantity}` : ""}
              </span>
              <span className="shrink-0 tabular-nums">
                {money(item.amount, currency)}
              </span>
            </div>
            {subs.length > 0 ? (
              <ul className="mt-0.5 space-y-0.5 border-l border-border/70 pl-2.5">
                {subs.map((sub, subIdx) => (
                  <li
                    key={`${item.name}-sub-${subIdx}`}
                    className={cn(
                      "flex items-baseline justify-between gap-2 text-muted-foreground/80",
                      dense ? "text-[9px] sm:text-[10px]" : "text-[10px] sm:text-xs"
                    )}
                  >
                    <span className="min-w-0 truncate">
                      {label(sub.name)}
                    </span>
                    {sub.amount != null && sub.amount > 0 ? (
                      <span className="shrink-0 tabular-nums">
                        {money(sub.amount, currency)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
