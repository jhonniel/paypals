"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/utils/cn";

type ClaimItem = {
  id: string;
  name: string;
  quantity: number;
  total_price: number;
};

type ClaimReceipt = {
  id: string;
  merchant: string | null;
  currency: string;
  total: number;
  uploaded_by: string;
  items: ClaimItem[];
};

function money(value: number, currency = "PHP") {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function softName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return name;
  if (trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) {
    return trimmed.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return trimmed;
}

/**
 * Blocks the group page until the member confirms picks on each pending receipt.
 */
export function GroupClaimGate({
  groupId,
  groupName,
  receipts,
}: {
  groupId: string;
  groupName: string;
  receipts: ClaimReceipt[];
}) {
  const qc = useQueryClient();
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  const [saving, setSaving] = useState(false);

  const current = receipts[index];
  const selectedForCurrent = useMemo(() => {
    if (!current) return new Set<string>();
    return selected[current.id] ?? new Set<string>();
  }, [current, selected]);

  const progressLabel = `${Math.min(index + 1, receipts.length)} of ${receipts.length}`;

  function toggleItem(itemId: string) {
    if (!current) return;
    setSelected((prev) => {
      const next = new Set(prev[current.id] ?? []);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return { ...prev, [current.id]: next };
    });
  }

  async function confirm(nothing = false) {
    if (!current) return;
    setSaving(true);
    try {
      const itemIds = nothing ? [] : [...selectedForCurrent];
      const res = await fetch(`/api/receipts/${current.id}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_ids: itemIds }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Could not save");

      toast.success(
        itemIds.length
          ? `Saved ${itemIds.length} item${itemIds.length === 1 ? "" : "s"}`
          : "Marked as nothing for you"
      );

      if (index + 1 >= receipts.length) {
        await qc.invalidateQueries({ queryKey: ["group", groupId] });
      } else {
        setIndex((i) => i + 1);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  if (!current) {
    return (
      <div className="space-y-4">
        <Skeletonish />
      </div>
    );
  }

  const currency = current.currency || "PHP";

  return (
    <div className="mx-auto w-full max-w-lg space-y-6">
      <div>
        <Link
          href="/groups"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Groups
        </Link>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {groupName} · Receipt {progressLabel}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Pick what you got
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tap your items so the split is fair. Confirm each receipt before opening
          the group.
        </p>
      </div>

      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="text-base sm:text-lg">
            {current.merchant ?? "Untitled receipt"}
          </CardTitle>
          <CardDescription>
            Uploaded by {current.uploaded_by} · {money(Number(current.total), currency)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0 sm:p-6 sm:pt-0">
          {current.items.map((item) => {
            const on = selectedForCurrent.has(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => toggleItem(item.id)}
                disabled={saving}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-2xl border px-3 py-3 text-left text-sm transition",
                  on
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-muted/40"
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                      on
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border"
                    )}
                  >
                    {on ? <Check className="h-3.5 w-3.5" /> : null}
                  </span>
                  <span className="truncate font-medium">{softName(item.name)}</span>
                  {item.quantity !== 1 ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      ×{item.quantity}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {money(item.total_price, currency)}
                </span>
              </button>
            );
          })}

          <div className="flex flex-col gap-2 pt-2">
            <Button
              className="w-full"
              onClick={() => void confirm(false)}
              disabled={saving || selectedForCurrent.size === 0}
            >
              {saving ? <Loader2 className="animate-spin" /> : null}
              {selectedForCurrent.size > 0
                ? `Confirm ${selectedForCurrent.size} item${selectedForCurrent.size === 1 ? "" : "s"}`
                : "Select your items"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => void confirm(true)}
              disabled={saving}
            >
              I didn’t get anything
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Skeletonish() {
  return (
    <div className="h-64 animate-pulse rounded-2xl bg-muted/40" />
  );
}
