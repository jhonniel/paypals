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

function SubItems({
  items,
  currency,
  dense,
  label,
  depth = 0,
}: {
  items: ReceiptSubItem[];
  currency: string;
  dense: boolean;
  label: (name: string) => string;
  depth?: number;
}) {
  if (!items.length) return null;
  return (
    <ul
      className={cn(
        "mt-0.5 space-y-0.5",
        depth === 0 ? "pl-3" : "pl-4"
      )}
    >
      {items.map((sub, subIdx) => (
        <li key={`${sub.name}-${subIdx}`} className="min-w-0">
          <div
            className={cn(
              "flex items-baseline justify-between gap-2 text-muted-foreground/85",
              dense ? "text-[9px] sm:text-[10px]" : "text-[10px] sm:text-xs"
            )}
          >
            <span className="min-w-0 truncate">
              <span className="mr-1.5 text-muted-foreground/50" aria-hidden>
                •
              </span>
              {label(sub.name)}
            </span>
            {sub.amount != null && sub.amount > 0 ? (
              <span className="shrink-0 tabular-nums">
                {money(sub.amount, currency)}
              </span>
            ) : null}
          </div>
          {sub.sub_items?.length ? (
            <SubItems
              items={sub.sub_items}
              currency={currency}
              dense={dense}
              label={label}
              depth={depth + 1}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

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
    <ul className={cn(dense ? "space-y-1.5" : "space-y-2")}>
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
              <span className="min-w-0 font-medium leading-snug text-foreground/90">
                {label(item.name)}
                {(item.quantity ?? 1) > 1 ? ` ×${item.quantity}` : ""}
              </span>
              <span className="shrink-0 tabular-nums font-medium">
                {money(item.amount, currency)}
              </span>
            </div>
            <SubItems
              items={subs}
              currency={currency}
              dense={dense}
              label={label}
            />
          </li>
        );
      })}
    </ul>
  );
}
