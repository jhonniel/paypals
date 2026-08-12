"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Loader2, Minus, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/utils/cn";
import { readApiJson } from "@/lib/api-client";
import {
  isItemHiddenFromMember,
  itemSplitModeLabel,
  type ItemSplitMode,
} from "@/lib/splits";

type ClaimItem = {
  id: string;
  name: string;
  quantity: number;
  total_price: number;
  split_mode?: string | null;
  split_n?: number | null;
  claimer_ids?: string[];
  claimed_by?: string[];
  remaining_quantity?: number;
  claimed_quantity?: number | null;
  claims?: Array<{ member_id: string; name: string; quantity: number }>;
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

function formatItemPickers(
  item: ClaimItem,
  excludeMemberId?: string | null
) {
  const pickers = (item.claims ?? []).filter(
    (c) => !excludeMemberId || c.member_id !== excludeMemberId
  );
  if (pickers.length > 0) {
    return pickers
      .map((c) => (c.quantity > 1 ? `${c.name} ×${c.quantity}` : c.name))
      .join(", ");
  }
  if ((item.claimed_by ?? []).length > 0) {
    return item.claimed_by!.join(", ");
  }
  return null;
}

type TakenByUser = {
  key: string;
  name: string;
  items: Array<{ id: string; label: string }>;
};

function groupClaimsByUser(
  items: ClaimItem[],
  excludeMemberId?: string | null
): TakenByUser[] {
  const byUser = new Map<string, TakenByUser>();

  for (const item of items) {
    const claims = (item.claims ?? []).filter(
      (c) =>
        c.quantity > 0 &&
        (!excludeMemberId || c.member_id !== excludeMemberId)
    );

    if (claims.length > 0) {
      for (const claim of claims) {
        const existing = byUser.get(claim.member_id);
        const label =
          claim.quantity > 1
            ? `${softName(item.name)} ×${claim.quantity}`
            : softName(item.name);
        const rowId = `${item.id}-${claim.member_id}`;
        if (existing) {
          if (!existing.items.some((row) => row.id === rowId)) {
            existing.items.push({ id: rowId, label });
          }
        } else {
          byUser.set(claim.member_id, {
            key: claim.member_id,
            name: claim.name,
            items: [{ id: rowId, label }],
          });
        }
      }
      continue;
    }

    if (excludeMemberId) {
      for (const name of item.claimed_by ?? []) {
        const key = `name:${name}`;
        const label = softName(item.name);
        const rowId = `${item.id}-${key}`;
        const existing = byUser.get(key);
        if (existing) {
          if (!existing.items.some((row) => row.id === rowId)) {
            existing.items.push({ id: rowId, label });
          }
        } else {
          byUser.set(key, {
            key,
            name,
            items: [{ id: rowId, label }],
          });
        }
      }
    }
  }

  return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Multi-unit / multi-share items — pickers show only when fully taken. */
function itemHasMultiPool(item: ClaimItem) {
  const mode = (item.split_mode ?? "among_n") as ItemSplitMode;
  const splitN = Math.max(1, Math.floor(Number(item.split_n) || 1));
  const qtyOnReceipt = Math.max(0, Number(item.quantity) || 0);
  if (mode === "among_n" && splitN > 1) return true;
  if (mode === "among_claimers" && qtyOnReceipt > 1) return true;
  return false;
}

/** Claim pool size: N-way shares vs receipt line units. */
function itemPoolSize(item: ClaimItem) {
  const mode = (item.split_mode ?? "among_n") as ItemSplitMode;
  const splitN = Math.max(1, Math.floor(Number(item.split_n) || 1));
  const qtyOnReceipt = Math.max(0, Number(item.quantity) || 0);
  if (mode === "among_n" && splitN > 1) return splitN;
  return Math.max(qtyOnReceipt, 1);
}

function myClaimQty(item: ClaimItem, memberId?: string | null) {
  if (!memberId) return 0;
  const mine = item.claims?.find((c) => c.member_id === memberId);
  return Math.max(0, Number(mine?.quantity) || 0);
}

function totalClaimedQty(item: ClaimItem) {
  return (item.claims ?? []).reduce(
    (sum, c) => sum + Math.max(0, Number(c.quantity) || 0),
    0
  );
}

function memberHasClaim(item: ClaimItem, memberId?: string | null) {
  if (!memberId) return false;
  if ((item.claimer_ids ?? []).includes(memberId)) return true;
  return myClaimQty(item, memberId) > 0;
}

/**
 * Claim / re-pick items on receipt(s).
 * - gate: full-page blocker until first confirm
 * - modal: edit picks without leaving the group page
 */
export function GroupClaimGate({
  groupId,
  groupName,
  receipts,
  myMemberId,
  forMemberId,
  forMemberName,
  memberCount = 1,
  variant = "gate",
  onClose,
}: {
  groupId: string;
  groupName: string;
  receipts: ClaimReceipt[];
  myMemberId?: string | null;
  /** When set (owner/admin), picks are saved for this member instead. */
  forMemberId?: string | null;
  forMemberName?: string | null;
  /** Used to estimate whole-group item shares */
  memberCount?: number;
  variant?: "gate" | "modal";
  onClose?: () => void;
}) {
  const qc = useQueryClient();
  const isModal = variant === "modal";
  const claimMemberId = forMemberId || myMemberId;
  const assigningForOther = Boolean(
    forMemberId && myMemberId && forMemberId !== myMemberId
  );
  const [index, setIndex] = useState(0);
  /** receiptId -> itemId -> quantity claimed by me */
  const [quantities, setQuantities] = useState<Record<string, Record<string, number>>>(
    {}
  );
  const [saving, setSaving] = useState(false);
  const [seededFor, setSeededFor] = useState<string | null>(null);

  const current = receipts[index];

  // Prefill from this member's existing claims (so re-open shows what they picked)
  useEffect(() => {
    if (!current || !claimMemberId) return;
    if (seededFor === current.id) return;
    const q: Record<string, number> = {};
    for (const item of current.items) {
      const mine = item.claims?.find((c) => c.member_id === claimMemberId);
      if (mine && mine.quantity > 0) q[item.id] = mine.quantity;
    }
    setQuantities((prev) => ({ ...prev, [current.id]: q }));
    setSeededFor(current.id);
  }, [current, claimMemberId, seededFor]);

  const qtyForCurrent = useMemo(() => {
    if (!current) return {} as Record<string, number>;
    return quantities[current.id] ?? {};
  }, [current, quantities]);

  const { availableItems, takenItems } = useMemo(() => {
    if (!current) return { availableItems: [] as ClaimItem[], takenItems: [] as ClaimItem[] };
    const available: ClaimItem[] = [];
    const taken: ClaimItem[] = [];
    for (const item of current.items) {
      const mode = (item.split_mode ?? "among_n") as ItemSplitMode;
      if (mode === "among_group") {
        // Always listed (everyone pays) — not a pick
        available.push(item);
        continue;
      }

      const claimers = item.claimer_ids ?? [];
      const myQtyClaimed = myClaimQty(item, claimMemberId);
      const iClaimed = memberHasClaim(item, claimMemberId);
      const splitN = Math.max(1, Math.floor(Number(item.split_n) || 1));
      const multiWay = mode === "among_n" && splitN > 1;
      const itemQty = Math.max(0, Number(item.quantity) || 0);
      const poolSize =
        multiWay ? splitN : mode === "among_claimers" ? itemQty : itemQty;
      const totalClaimed = totalClaimedQty(item);
      const poolLeft = Math.max(0, poolSize - totalClaimed);

      let remaining: number;
      if (multiWay) {
        remaining = iClaimed
          ? Math.max(poolLeft + myQtyClaimed, myQtyClaimed)
          : poolLeft;
      } else if (mode === "among_claimers") {
        remaining = iClaimed
          ? Math.max(poolLeft + myQtyClaimed, myQtyClaimed)
          : poolLeft;
      } else {
        // One person: unavailable once anyone else claimed
        remaining =
          claimers.length > 0 && !iClaimed
            ? 0
            : Math.max(1, itemQty || 1);
      }

      const hidden = isItemHiddenFromMember(
        mode,
        item.split_n ?? 1,
        claimers,
        claimMemberId,
        { remainingQuantity: poolLeft, itemQuantity: item.quantity }
      );

      // Fully taken by others → hidden from pick list
      if ((hidden || poolLeft <= 0) && !iClaimed) {
        taken.push(item);
        continue;
      }

      available.push({ ...item, remaining_quantity: remaining });
    }
    return { availableItems: available, takenItems: taken };
  }, [current, claimMemberId]);

  const takenByUser = useMemo(() => {
    if (!current) return [];
    const pickable = current.items.filter(
      (item) => (item.split_mode ?? "among_n") !== "among_group"
    );
    return groupClaimsByUser(pickable, claimMemberId);
  }, [current, claimMemberId]);

  const othersPickCount = useMemo(
    () => takenByUser.reduce((total, group) => total + group.items.length, 0),
    [takenByUser]
  );

  const progressLabel = `${Math.min(index + 1, receipts.length)} of ${receipts.length}`;

  function maxForItem(item: ClaimItem) {
    const mode = (item.split_mode ?? "among_n") as ItemSplitMode;
    const splitN = Math.max(1, Math.floor(Number(item.split_n) || 1));
    const multiWay = mode === "among_n" && splitN > 1;
    const itemQty = Math.max(0, Number(item.quantity) || 0);
    const mine = myClaimQty(item, claimMemberId);

    if (multiWay) {
      const poolLeft = Math.max(0, splitN - totalClaimedQty(item));
      return Math.max(poolLeft + mine, mine);
    }

    if (mode === "among_claimers") {
      const poolLeft = Math.max(0, itemQty - totalClaimedQty(item));
      return Math.max(poolLeft + mine, mine);
    }

    const remaining =
      item.remaining_quantity != null
        ? Math.max(0, Number(item.remaining_quantity))
        : itemQty;
    const pool = remaining > 0 ? remaining : itemQty;
    return Math.max(0, pool);
  }

  /** One-person split — no share stepper; tap claims the line */
  function isOnePersonSplit(item: ClaimItem) {
    const mode = (item.split_mode ?? "among_n") as ItemSplitMode;
    if (mode === "among_group" || mode === "among_claimers") return false;
    const n = Number(item.split_n) || 1;
    return n <= 1;
  }

  /** Split 2+ ways (or open claimers with multiple units) — show share/qty stepper */
  function showQtyControls(item: ClaimItem) {
    const mode = (item.split_mode ?? "among_n") as ItemSplitMode;
    const splitN = Math.max(1, Math.floor(Number(item.split_n) || 1));
    if (mode === "among_n" && splitN > 1) return true;
    if (mode === "among_claimers") return maxForItem(item) > 1;
    return false;
  }

  function setQty(itemId: string, qty: number, max: number) {
    if (!current) return;
    const next = Math.max(0, Math.min(max, qty));
    setQuantities((prev) => {
      const forReceipt = { ...(prev[current.id] ?? {}) };
      if (next <= 0) delete forReceipt[itemId];
      else forReceipt[itemId] = next;
      return { ...prev, [current.id]: forReceipt };
    });
  }

  function toggleItem(item: ClaimItem) {
    if (!current) return;
    const cur = qtyForCurrent[item.id] ?? 0;
    const max = maxForItem(item);
    if (max <= 0) return;
    if (cur > 0) {
      setQty(item.id, 0, max);
    } else if (isOnePersonSplit(item)) {
      setQty(item.id, max, max);
    } else {
      // Multi-way split: start at 1 share; +/- to take more of what's left
      setQty(item.id, Math.min(1, max), max);
    }
  }

  async function confirm() {
    if (!current) return;
    setSaving(true);
    try {
      const claims = availableItems
        .filter((i) => (qtyForCurrent[i.id] ?? 0) > 0)
        .filter((i) => (i.split_mode ?? "among_n") !== "among_group")
        .map((i) => ({
          item_id: i.id,
          quantity: qtyForCurrent[i.id] ?? 1,
        }));

      const res = await fetch(`/api/receipts/${current.id}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claims,
          ...(assigningForOther && forMemberId
            ? { for_member_id: forMemberId }
            : {}),
        }),
      });
      const parsed = await readApiJson<{ data: { confirmed: boolean; claimed: number } }>(
        res
      );
      if (!parsed.ok) throw new Error(parsed.message);

      toast.success(
        assigningForOther
          ? claims.length
            ? `Saved picks for ${forMemberName || "member"} — about ${money(payTotal, currency)}`
            : `Cleared picks for ${forMemberName || "member"}`
          : claims.length
            ? `Saved — you pay about ${money(payTotal, currency)} on this receipt`
            : "Updated picks"
      );

      await qc.invalidateQueries({ queryKey: ["group", groupId] });
      await qc.invalidateQueries({ queryKey: ["groups"] });

      if (isModal && !assigningForOther) {
        onClose?.();
        return;
      }

      if (index + 1 >= receipts.length) {
        if (isModal) onClose?.();
        // gate complete — invalidate already refreshed must_claim_before_view
      } else {
        setIndex((i) => i + 1);
        setSeededFor(null);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  function shareAmountFor(item: ClaimItem, myQty: number): number {
    const mode = (item.split_mode ?? "among_n") as ItemSplitMode;
    const total = Number(item.total_price) || 0;
    if (mode === "among_group") {
      const n = Math.max(1, memberCount);
      return total / n;
    }
    if (myQty <= 0) return 0;
    const splitN = Math.max(1, Math.floor(Number(item.split_n) || 1));
    if (mode === "among_n" && splitN > 1) {
      return (total * myQty) / splitN;
    }
    const qtyOnReceipt = Math.max(0.001, Number(item.quantity) || 1);
    return (total / qtyOnReceipt) * myQty;
  }

  const payTotal = useMemo(() => {
    let sum = 0;
    for (const item of availableItems) {
      const mode = (item.split_mode ?? "among_n") as ItemSplitMode;
      if (mode === "among_group") {
        sum += shareAmountFor(item, 1);
        continue;
      }
      const myQty = qtyForCurrent[item.id] ?? 0;
      if (myQty > 0) sum += shareAmountFor(item, myQty);
    }
    return sum;
    // shareAmountFor closes over memberCount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableItems, qtyForCurrent, memberCount]);

  const currency = current?.currency || "PHP";
  const selectedCount = availableItems.filter(
    (i) =>
      (qtyForCurrent[i.id] ?? 0) > 0 &&
      (i.split_mode ?? "among_n") !== "among_group"
  ).length;
  const selectableCount = availableItems.filter(
    (i) => (i.split_mode ?? "among_n") !== "among_group"
  ).length;

  if (!current) {
    return <div className="h-64 animate-pulse rounded-2xl bg-muted/40" />;
  }

  return (
    <div className={cn("mx-auto w-full max-w-lg space-y-6", isModal && "space-y-4")}>
      <div className={cn(isModal && "flex items-start justify-between gap-3")}>
        {!isModal ? (
          <Link
            href="/groups"
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Groups
          </Link>
        ) : null}
        <div className="min-w-0">
          {!isModal ? (
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {groupName} · Receipt {progressLabel}
            </p>
          ) : (
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {groupName}
              {assigningForOther && receipts.length > 1
                ? ` · Receipt ${progressLabel}`
                : ""}
            </p>
          )}
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {assigningForOther
              ? `Pick for ${forMemberName || "member"}`
              : isModal
                ? "Edit what you got"
                : "Pick what you got"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {assigningForOther
              ? "Choose what they ordered. They’ll see these items on their share."
              : isModal
                ? "Only items still available are listed. Already claimed ones are hidden."
                : "Only what’s left to claim is listed — taken items stay hidden so you can spot yours easily."}
          </p>
        </div>
        {isModal && onClose ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="shrink-0"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </Button>
        ) : null}
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
          {availableItems.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
              Nothing left to pick
              {takenItems.length > 0
                ? " — everything else was already claimed."
                : "."}
            </p>
          ) : (
            availableItems.map((item) => {
              const myQty = qtyForCurrent[item.id] ?? 0;
              const on = myQty > 0;
              const mode = (item.split_mode ?? "among_n") as ItemSplitMode;
              const wholeGroup = mode === "among_group";
              const splitN = Number(item.split_n) || 1;
              const isOnePerson = mode === "among_n" && splitN <= 1;
              const hint = itemSplitModeLabel(mode, item.split_n);
              const max = maxForItem(item);
              const qtyOnReceipt = Number(item.quantity);
              const poolSize = itemPoolSize(item);
              const poolLeft = Math.max(0, poolSize - totalClaimedQty(item));
              const multiWay = mode === "among_n" && splitN > 1;
              const metaParts: string[] = [];
              if (!isOnePerson) metaParts.push(hint);
              if (multiWay) {
                metaParts.push(
                  `${poolLeft} of ${poolSize} share${poolSize === 1 ? "" : "s"} left`
                );
              } else if (itemHasMultiPool(item)) {
                if (poolLeft > 0) {
                  metaParts.push(`${poolLeft} of ${poolSize} left`);
                } else if (myClaimQty(item, claimMemberId) > 0) {
                  metaParts.push("Your pick");
                } else if (qtyOnReceipt > 1) {
                  metaParts.push(`${poolSize} on receipt`);
                }
              } else if (poolLeft < qtyOnReceipt && poolLeft > 0) {
                metaParts.push(`${poolLeft} left`);
              }
              const myShare = wholeGroup
                ? shareAmountFor(item, 1)
                : on
                  ? shareAmountFor(item, myQty)
                  : 0;
              const otherPickers = formatItemPickers(item, claimMemberId);

              return (
                <div
                  key={item.id}
                  className={cn(
                    "rounded-2xl border px-3 py-3 text-sm transition",
                    wholeGroup
                      ? "border-border bg-muted/20 opacity-90"
                      : on
                        ? "border-primary bg-primary/10"
                        : "border-border"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (!wholeGroup) toggleItem(item);
                    }}
                    disabled={saving || wholeGroup || max <= 0}
                    className="flex w-full flex-col gap-1 text-left"
                  >
                    <span className="flex w-full items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className={cn(
                            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                            wholeGroup || on
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border"
                          )}
                        >
                          {wholeGroup || on ? <Check className="h-3.5 w-3.5" /> : null}
                        </span>
                        <span className="truncate font-medium">{softName(item.name)}</span>
                      </span>
                      <span className="shrink-0 text-right tabular-nums text-muted-foreground">
                        {(on || wholeGroup) && myShare > 0 ? (
                          <>
                            <span className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">
                              You pay
                            </span>
                            <span className="font-medium text-foreground">
                              {money(myShare, currency)}
                            </span>
                          </>
                        ) : (
                          money(item.total_price, currency)
                        )}
                      </span>
                    </span>
                    {metaParts.length > 0 && (
                      <span className="pl-8 text-[11px] text-muted-foreground">
                        {metaParts.join(" · ")}
                      </span>
                    )}
                    {!wholeGroup && otherPickers && !itemHasMultiPool(item) ? (
                      <span className="pl-8 text-[11px] text-muted-foreground">
                        Others: {otherPickers}
                      </span>
                    ) : null}
                  </button>

                  {on && !wholeGroup && showQtyControls(item) && max > 0 && (
                    <div className="mt-2 flex items-center justify-between gap-2 pl-8">
                      <span className="text-xs text-muted-foreground">
                        Your shares
                        <span className="text-muted-foreground/80">
                          {" "}
                          · {max} of {poolSize} left
                        </span>
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="h-8 w-8"
                          disabled={saving || myQty <= 1}
                          onClick={() => setQty(item.id, myQty - 1, max)}
                          aria-label="Less"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </Button>
                        <span className="min-w-[2rem] text-center text-sm font-semibold tabular-nums">
                          {myQty}
                        </span>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="h-8 w-8"
                          disabled={saving || myQty >= max}
                          onClick={() => setQty(item.id, myQty + 1, max)}
                          aria-label="More"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                        <span className="text-xs font-medium tabular-nums text-foreground">
                          {money(myShare, currency)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}

          {(takenItems.length > 0 || takenByUser.length > 0) && (
            <details className="rounded-2xl border border-border/60 bg-muted/15 px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                {othersPickCount > 0
                  ? takenItems.length > 0 &&
                    takenItems.length < othersPickCount
                    ? `Others' picks (${othersPickCount}) · ${takenItems.length} hidden from your list`
                    : `Others' picks (${othersPickCount})`
                  : takenItems.length > 0
                    ? `Already taken (${takenItems.length}) — hidden from your list`
                    : "Others' picks"}
              </summary>
              <div className="mt-2 space-y-3">
                {takenByUser.length > 0 ? (
                  takenByUser.map((group) => (
                    <div key={group.key}>
                      <p className="text-xs font-semibold text-foreground/90">
                        {group.name}
                        <span className="ml-1.5 font-normal text-muted-foreground">
                          ({group.items.length})
                        </span>
                      </p>
                      <ul className="mt-1 space-y-0.5 pl-3">
                        {group.items.map((row) => (
                          <li
                            key={row.id}
                            className="flex gap-1.5 text-[11px] text-muted-foreground"
                          >
                            <span className="shrink-0">·</span>
                            <span className="min-w-0 truncate">{row.label}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))
                ) : (
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {takenItems.map((item) => (
                      <li key={item.id} className="truncate">
                        {softName(item.name)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
          )}

          <div className="sticky bottom-0 space-y-2 border-t border-border bg-card pt-3">
            <div className="flex items-end justify-between gap-3 rounded-2xl bg-primary/10 px-4 py-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {assigningForOther
                    ? `${forMemberName || "They"} pay for this receipt`
                    : "You pay for this receipt"}
                </p>
                <p className="text-2xl font-semibold tabular-nums tracking-tight">
                  {money(payTotal, currency)}
                </p>
              </div>
              {selectedCount > 0 && (
                <p className="pb-1 text-xs text-muted-foreground">
                  {selectedCount} item{selectedCount === 1 ? "" : "s"}
                </p>
              )}
            </div>
            <Button
              className="w-full"
              onClick={() => void confirm()}
              disabled={
                saving ||
                (!isModal && selectableCount > 0 && selectedCount === 0)
              }
            >
              {saving ? <Loader2 className="animate-spin" /> : null}
              {selectedCount > 0
                ? assigningForOther && index + 1 < receipts.length
                  ? `Save & next · ${money(payTotal, currency)}`
                  : `Save · ${money(payTotal, currency)}`
                : selectableCount === 0
                  ? `Continue · ${money(payTotal, currency)}`
                  : isModal
                    ? assigningForOther
                      ? "Save with no items"
                      : "Save with no items"
                    : "Select your items"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
