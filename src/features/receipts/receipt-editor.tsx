"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Split,
  Merge,
  Loader2,
  Save,
  CheckCircle2,
  RefreshCw,
  ArrowLeft,
} from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { computeReceiptTotals, formatPHP, lineTotal, moneyNumber } from "@/lib/money";
import { sumDiscountAmount } from "@/lib/receipt-discounts";
import { itemSplitPerPersonAmount } from "@/lib/splits";
import { cn } from "@/utils/cn";
import { readApiJson } from "@/lib/api-client";
import { ReceiptScanOverlay } from "@/components/receipt-scan-overlay";
import {
  normalizeSubItems,
  type ReceiptSubItem,
} from "@/lib/receipt-sub-items";

function EditorSubItems({
  items,
  currency,
  depth = 0,
}: {
  items: ReceiptSubItem[];
  currency: string;
  depth?: number;
}) {
  if (!items.length) return null;
  return (
    <ul
      className={cn(
        "space-y-0.5 border-l border-border/70",
        depth === 0 ? "pl-2.5" : "ml-2 pl-2.5"
      )}
    >
      {items.map((sub, subIdx) => (
        <li key={`${sub.name}-${subIdx}`} className="min-w-0">
          <div className="flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="min-w-0 truncate">
              <span className="mr-1 text-muted-foreground/50" aria-hidden>
                •
              </span>
              {sub.name}
            </span>
            {sub.amount != null && Number(sub.amount) > 0 ? (
              <span className="shrink-0 tabular-nums">
                {formatPHP(Number(sub.amount), currency)}
              </span>
            ) : null}
          </div>
          {sub.sub_items?.length ? (
            <EditorSubItems
              items={sub.sub_items}
              currency={currency}
              depth={depth + 1}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export type EditorItem = {
  key: string;
  id?: string;
  name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  selected?: boolean;
  /** among_n = set number (default 1 = one person), among_group = group size */
  split_mode?: "among_n" | "among_group" | "among_claimers";
  split_n?: number | null;
  sub_items?: ReceiptSubItem[];
};

export type EditorDiscount = {
  key: string;
  id?: string;
  label: string;
  amount: number;
};

type ReceiptPayload = {
  receipt: {
    id: string;
    merchant: string | null;
    receipt_date: string | null;
    receipt_time: string | null;
    currency: string;
    subtotal: number;
    tax: number;
    discount: number;
    service_charge: number;
    tip: number;
    total: number;
    status: string;
    notes: string | null;
    ocr_confidence: number | null;
    group_id: string | null;
  };
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    unit_price: number;
    total_price: number;
    sort_order: number;
    split_mode?: string | null;
    split_n?: number | null;
    sub_items?: ReceiptSubItem[] | null;
  }>;
  discounts?: Array<{
    id?: string;
    label: string;
    amount: number;
    sort_order?: number;
  }>;
  imageUrl: string | null;
  canEdit: boolean;
};

function uid() {
  return crypto.randomUUID();
}

function buildEditorSnapshot(input: {
  merchant: string;
  date: string;
  time: string;
  notes: string;
  discounts: EditorDiscount[];
  serviceCharge: number;
  tip: number;
  groupId: string | null;
  items: EditorItem[];
}) {
  return JSON.stringify({
    merchant: input.merchant,
    date: input.date,
    time: input.time,
    notes: input.notes,
    discounts: input.discounts.map((d) => ({
      id: d.id ?? null,
      label: d.label,
      amount: d.amount,
    })),
    serviceCharge: input.serviceCharge,
    tip: input.tip,
    groupId: input.groupId,
    items: input.items.map((i) => ({
      id: i.id ?? null,
      name: i.name,
      quantity: i.quantity,
      unit_price: i.unit_price,
      total_price: i.total_price,
      split_mode: i.split_mode ?? "among_n",
      split_n: i.split_n ?? 1,
    })),
  });
}

export function ReceiptEditor({ receiptId }: { receiptId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reocr, setReocr] = useState(false);
  const [merchant, setMerchant] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");
  const [discounts, setDiscounts] = useState<EditorDiscount[]>([]);
  const [serviceCharge, setServiceCharge] = useState(0);
  const [tip, setTip] = useState(0);
  const [currency, setCurrency] = useState("PHP");
  const [status, setStatus] = useState("draft");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [showEnhanced, setShowEnhanced] = useState(false);
  const [items, setItems] = useState<EditorItem[]>([]);
  const [canEdit, setCanEdit] = useState(true);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [groupSize, setGroupSize] = useState(0);
  const [savedSnapshot, setSavedSnapshot] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/receipts/${receiptId}`);
      const parsed = await readApiJson<{ data: ReceiptPayload }>(res);
      if (!parsed.ok) throw new Error(parsed.message);
      const data = parsed.data.data;
      setCurrency(data.receipt.currency ?? "PHP");
      setStatus(data.receipt.status);
      setConfidence(data.receipt.ocr_confidence);
      setImageUrl(data.imageUrl);
      setCanEdit(data.canEdit !== false);
      setGroupId(data.receipt.group_id ?? null);
      const nextMerchant = data.receipt.merchant ?? "";
      const nextDate = data.receipt.receipt_date ?? "";
      const nextTime = (data.receipt.receipt_time ?? "").slice(0, 5);
      const nextNotes = data.receipt.notes ?? "";
      const nextDiscounts: EditorDiscount[] = (data.discounts ?? []).map((d) => ({
        key: d.id ?? uid(),
        id: d.id,
        label: d.label || "Discount",
        amount: Number(d.amount),
      }));
      const nextService = Number(data.receipt.service_charge);
      const nextTip = Number(data.receipt.tip);
      const nextItems: EditorItem[] = (data.items ?? []).map((i) => ({
        key: i.id,
        id: i.id,
        name: i.name,
        quantity: Number(i.quantity),
        unit_price: Number(i.unit_price),
        total_price: Number(i.total_price),
        selected: false,
        split_mode: (i.split_mode as EditorItem["split_mode"]) ?? "among_n",
        split_n: i.split_n ?? 1,
        sub_items: normalizeSubItems(i.sub_items),
      }));
      setMerchant(nextMerchant);
      setDate(nextDate);
      setTime(nextTime);
      setNotes(nextNotes);
      setDiscounts(nextDiscounts);
      setServiceCharge(nextService);
      setTip(nextTip);
      setItems(nextItems);
      setSavedSnapshot(
        buildEditorSnapshot({
          merchant: nextMerchant,
          date: nextDate,
          time: nextTime,
          notes: nextNotes,
          discounts: nextDiscounts,
          serviceCharge: nextService,
          tip: nextTip,
          groupId: data.receipt.group_id ?? null,
          items: nextItems,
        })
      );

      if (data.receipt.group_id) {
        try {
          const gRes = await fetch(`/api/groups/${data.receipt.group_id}`);
          const gJson = await gRes.json();
          if (gRes.ok) {
            setGroupSize(Array.isArray(gJson?.data?.members) ? gJson.data.members.length : 0);
          }
        } catch {
          setGroupSize(0);
        }
      } else {
        setGroupSize(0);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptId]);

  useEffect(() => {
    if (!groupId) {
      setGroupSize(0);
      return;
    }
    let cancelled = false;
    void fetch(`/api/groups/${groupId}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        const members = json?.data?.members;
        if (Array.isArray(members)) {
          setGroupSize(members.length);
          return;
        }
        const count = json?.data?.member_count;
        setGroupSize(typeof count === "number" ? count : 0);
      })
      .catch(() => {
        if (!cancelled) setGroupSize(0);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  const discountTotal = useMemo(() => sumDiscountAmount(discounts), [discounts]);

  const totals = useMemo(
    () =>
      computeReceiptTotals({
        items: items.map((i) => ({
          quantity: i.quantity,
          unitPrice: i.unit_price,
          totalPrice: i.total_price,
        })),
        tax: 0,
        discount: discountTotal,
        serviceCharge,
        tip,
      }),
    [items, discountTotal, serviceCharge, tip]
  );

  const isDirty =
    canEdit &&
    !!savedSnapshot &&
    buildEditorSnapshot({
      merchant,
      date,
      time,
      notes,
      discounts,
      serviceCharge,
      tip,
      groupId,
      items,
    }) !== savedSnapshot;

  const { data: ownedGroups } = useQuery({
    queryKey: ["groups-owned-for-receipt"],
    enabled: canEdit,
    queryFn: async () => {
      const res = await fetch("/api/groups");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed");
      const rows = (json.data ?? []) as Array<{
        id: string;
        name: string;
        my_role?: string;
        created_by?: string;
      }>;
      return rows.filter((g) => g.my_role === "owner");
    },
  });

  function addDiscount() {
    setDiscounts((prev) => [
      ...prev,
      { key: uid(), label: prev.length === 0 ? "Discount" : "Discount", amount: 0 },
    ]);
  }

  function updateDiscount(key: string, patch: Partial<EditorDiscount>) {
    setDiscounts((prev) =>
      prev.map((row) => (row.key === key ? { ...row, ...patch } : row))
    );
  }

  function removeDiscount(key: string) {
    setDiscounts((prev) => prev.filter((row) => row.key !== key));
  }

  function updateItem(key: string, patch: Partial<EditorItem>, recalc = true) {
    setItems((prev) =>
      prev.map((item) => {
        if (item.key !== key) return item;
        const next = { ...item, ...patch };
        if (recalc && (patch.quantity !== undefined || patch.unit_price !== undefined)) {
          next.total_price = lineTotal(next.quantity, next.unit_price);
        }
        return next;
      })
    );
  }

  function applySplitValue(key: string, value: string, currentN: number) {
    if (value === "one") {
      updateItem(key, { split_mode: "among_n", split_n: 1 }, false);
    } else if (value === "number") {
      updateItem(
        key,
        {
          split_mode: "among_n",
          split_n: Math.max(2, currentN > 1 ? currentN : 2),
        },
        false
      );
    } else if (value === "group") {
      if (!groupId) {
        toast.error("Link a group first to use Group split");
        return;
      }
      updateItem(key, { split_mode: "among_group", split_n: null }, false);
    } else {
      updateItem(key, { split_mode: "among_claimers", split_n: null }, false);
    }
  }

  function addItem() {
    setItems((prev) => [
      ...prev,
      {
        key: uid(),
        name: "New item",
        quantity: 1,
        unit_price: 0,
        total_price: 0,
        selected: false,
        split_mode: "among_n",
        split_n: 1,
      },
    ]);
  }

  function deleteSelected() {
    setItems((prev) => prev.filter((i) => !i.selected));
  }

  function mergeSelected() {
    const selected = items.filter((i) => i.selected);
    if (selected.length < 2) {
      toast.error("Select at least two items to merge");
      return;
    }
    const merged: EditorItem = {
      key: uid(),
      name: selected.map((i) => i.name).join(" + "),
      quantity: 1,
      unit_price: moneyNumber(
        selected.reduce((s, i) => s + i.total_price, 0)
      ),
      total_price: moneyNumber(
        selected.reduce((s, i) => s + i.total_price, 0)
      ),
      selected: false,
      split_mode: "among_n",
      split_n: 1,
    };
    setItems((prev) => [...prev.filter((i) => !i.selected), merged]);
  }

  function splitSelected() {
    const selected = items.filter((i) => i.selected);
    if (selected.length !== 1) {
      toast.error("Select exactly one item to split");
      return;
    }
    const item = selected[0];
    const halfQty = Math.max(0.001, item.quantity / 2);
    const a: EditorItem = {
      key: uid(),
      name: `${item.name} (1)`,
      quantity: moneyNumber(halfQty),
      unit_price: item.unit_price,
      total_price: lineTotal(halfQty, item.unit_price),
      split_mode: item.split_mode ?? "among_n",
      split_n: item.split_n ?? 1,
    };
    const b: EditorItem = {
      key: uid(),
      name: `${item.name} (2)`,
      quantity: moneyNumber(item.quantity - halfQty),
      unit_price: item.unit_price,
      total_price: lineTotal(item.quantity - halfQty, item.unit_price),
      split_mode: item.split_mode ?? "among_n",
      split_n: item.split_n ?? 1,
    };
    setItems((prev) => [...prev.filter((i) => i.key !== item.key), a, b]);
  }

  async function save(finalize = false) {
    if (!canEdit) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/receipts/${receiptId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant: merchant || null,
          receipt_date: date || null,
          receipt_time: time ? `${time}:00` : null,
          notes: notes || null,
          currency,
          tax: 0,
          discounts: discounts
            .filter((row) => row.label.trim() && row.amount > 0)
            .map((row) => ({
              label: row.label.trim(),
              amount: row.amount,
            })),
          service_charge: serviceCharge,
          tip,
          group_id: groupId,
          status: finalize ? "finalized" : "edited",
          items: items.map((i, index) => ({
            name: i.name,
            quantity: i.quantity,
            unit_price: i.unit_price,
            total_price: i.total_price,
            sort_order: index,
            split_mode: i.split_mode ?? "among_n",
            split_n:
              (i.split_mode ?? "among_n") === "among_n"
                ? Math.max(1, i.split_n ?? 1)
                : null,
          })),
        }),
      });
      const parsed = await readApiJson(res);
      if (!parsed.ok) throw new Error(parsed.message);
      toast.success(finalize ? "Receipt finalized" : "Changes saved");
      setStatus(finalize ? "finalized" : "edited");
      setSavedSnapshot(
        buildEditorSnapshot({
          merchant,
          date,
          time,
          notes,
          discounts,
          serviceCharge,
          tip,
          groupId,
          items,
        })
      );
      if (finalize) router.push("/receipts");
      else {
        // Refresh so new line items pick up server ids without a full-page loading state
        void fetch(`/api/receipts/${receiptId}`)
          .then((r) => readApiJson<{ data: ReceiptPayload }>(r))
          .then((parsed) => {
            if (!parsed.ok) return;
            const data = parsed.data.data;
            const nextItems: EditorItem[] = (data.items ?? []).map((i) => ({
              key: i.id,
              id: i.id,
              name: i.name,
              quantity: Number(i.quantity),
              unit_price: Number(i.unit_price),
              total_price: Number(i.total_price),
              selected: false,
              split_mode: (i.split_mode as EditorItem["split_mode"]) ?? "among_n",
              split_n: i.split_n ?? 1,
              sub_items: normalizeSubItems(i.sub_items),
            }));
            const nextDiscounts: EditorDiscount[] = (data.discounts ?? []).map((d) => ({
              key: d.id ?? uid(),
              id: d.id,
              label: d.label || "Discount",
              amount: Number(d.amount),
            }));
            setItems(nextItems);
            setDiscounts(nextDiscounts);
            setGroupId(data.receipt.group_id ?? null);
            setStatus(data.receipt.status);
            setSavedSnapshot(
              buildEditorSnapshot({
                merchant: data.receipt.merchant ?? "",
                date: data.receipt.receipt_date ?? "",
                time: (data.receipt.receipt_time ?? "").slice(0, 5),
                notes: data.receipt.notes ?? "",
                discounts: nextDiscounts,
                serviceCharge: Number(data.receipt.service_charge),
                tip: Number(data.receipt.tip),
                groupId: data.receipt.group_id ?? null,
                items: nextItems,
              })
            );
          })
          .catch(() => undefined);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function rerunOcr() {
    if (!canEdit) return;
    setReocr(true);
    try {
      const res = await fetch(`/api/ocr/${receiptId}`, { method: "POST" });
      const parsed = await readApiJson(res);
      if (!parsed.ok) throw new Error(parsed.message);
      toast.success("OCR refreshed");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "OCR failed");
    } finally {
      setReocr(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link
            href={groupId ? `/groups/${groupId}` : "/receipts"}
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />{" "}
            {groupId ? "Back to group" : "All receipts"}
          </Link>
          <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">
            {merchant || "Untitled receipt"}
          </h1>
          <p className="mt-1 text-sm capitalize text-muted-foreground">
            {status.replaceAll("_", " ")}
            {confidence != null ? ` · OCR ${confidence}%` : ""}
            {!canEdit ? " · View only" : ""}
          </p>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            {imageUrl && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void rerunOcr()}
                disabled={reocr}
              >
                {reocr ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Re-run OCR
              </Button>
            )}
            {isDirty && (
              <Button size="sm" onClick={() => void save(false)} disabled={saving}>
                {saving ? <Loader2 className="animate-spin" /> : <Save />}
                Save changes
              </Button>
            )}
            <Button
              size="sm"
              variant={isDirty ? "outline" : "default"}
              onClick={() => void save(true)}
              disabled={saving}
            >
              <CheckCircle2 /> Finalize
            </Button>
          </div>
        ) : (
          <p className="max-w-xs text-sm text-muted-foreground">
            Only the person who uploaded this receipt can edit line items. You can still view the
            image and totals below.
          </p>
        )}
      </div>

      {canEdit && isDirty && (
        <div className="fixed inset-x-0 bottom-[4.25rem] z-30 px-4 lg:bottom-6 lg:left-auto lg:right-8 lg:w-auto lg:px-0">
          <div className="mx-auto flex max-w-lg items-center gap-3 rounded-2xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur-xl lg:mx-0">
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">
              You have unsaved changes
            </p>
            <Button onClick={() => void save(false)} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              Save
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="space-y-6 min-w-0">
          <Card>
            <CardHeader className="p-4 sm:p-6">
              <CardTitle className="text-base sm:text-lg">Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 p-4 pt-0 sm:grid-cols-2 sm:p-6 sm:pt-0">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="merchant">Merchant</Label>
                <Input
                  id="merchant"
                  value={merchant}
                  onChange={(e) => setMerchant(e.target.value)}
                  readOnly={!canEdit}
                  disabled={!canEdit}
                />
              </div>
              {canEdit && (
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="receipt-group">Group</Label>
                  <select
                    id="receipt-group"
                    className="flex h-11 w-full rounded-xl border border-input bg-surface-elevated/60 px-3 text-sm disabled:opacity-60"
                    value={groupId ?? ""}
                    onChange={(e) => setGroupId(e.target.value || null)}
                  >
                    <option value="">Not linked — pick a group to split</option>
                    {(ownedGroups ?? []).map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Only groups you created can be linked. Members then pick what they got.
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="date">Date</Label>
                <Input
                  id="date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  readOnly={!canEdit}
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="time">Time</Label>
                <Input
                  id="time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  readOnly={!canEdit}
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  readOnly={!canEdit}
                  disabled={!canEdit}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-col gap-3 space-y-0 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <div>
                <CardTitle className="text-base sm:text-lg">Line items</CardTitle>
                <CardDescription>
                  {canEdit
                    ? groupId
                      ? "Edit items and split — Group split divides each line equally among all members"
                      : "Edit names, amounts, and how each item is split"
                    : "View only — the uploader manages line items"}
                </CardDescription>
              </div>
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={addItem}>
                    <Plus /> Add
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={mergeSelected}>
                    <Merge /> Merge
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={splitSelected}>
                    <Split /> Split
                  </Button>
                  <Button type="button" size="sm" variant="destructive" onClick={deleteSelected}>
                    <Trash2 /> Delete
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
              {items.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                  {canEdit
                    ? "No items — add one or re-run OCR."
                    : "No line items on this receipt yet."}
                </p>
              ) : (
                <>
                  {/* Mobile: stacked cards — no horizontal scroll */}
                  <div className="space-y-2 md:hidden">
                    {items.map((item) => {
                      const mode = item.split_mode ?? "among_n";
                      const splitN = item.split_n ?? 1;
                      const splitValue =
                        mode === "among_group"
                          ? "group"
                          : mode === "among_claimers"
                            ? "claimers"
                            : splitN <= 1
                              ? "one"
                              : "number";

                      return (
                        <div
                          key={item.key}
                          className={cn(
                            "rounded-xl border border-border p-3",
                            item.selected && "border-primary/40 bg-accent/30"
                          )}
                        >
                          <div className="flex items-start gap-2">
                            {canEdit && (
                              <input
                                type="checkbox"
                                className="mt-2.5 shrink-0"
                                checked={Boolean(item.selected)}
                                onChange={(e) =>
                                  updateItem(
                                    item.key,
                                    { selected: e.target.checked },
                                    false
                                  )
                                }
                                aria-label={`Select ${item.name}`}
                              />
                            )}
                            <div className="min-w-0 flex-1 space-y-2">
                              {canEdit ? (
                                <Input
                                  value={item.name}
                                  onChange={(e) =>
                                    updateItem(
                                      item.key,
                                      { name: e.target.value },
                                      false
                                    )
                                  }
                                  className="h-9"
                                  placeholder="Item"
                                />
                              ) : (
                                <p className="font-medium leading-snug">{item.name}</p>
                              )}
                              {(item.sub_items?.length ?? 0) > 0 ? (
                                <EditorSubItems
                                  items={item.sub_items!}
                                  currency={currency}
                                />
                              ) : null}

                              <div className="grid grid-cols-3 gap-2">
                                {canEdit ? (
                                  <>
                                    <EditableNumber
                                      value={item.quantity}
                                      min={0.001}
                                      onCommit={(n) =>
                                        updateItem(item.key, { quantity: n })
                                      }
                                      className="h-9 px-2 text-center tabular-nums"
                                      aria-label="Qty"
                                    />
                                    <EditableNumber
                                      value={item.unit_price}
                                      min={0}
                                      onCommit={(n) =>
                                        updateItem(item.key, { unit_price: n })
                                      }
                                      className="h-9 px-2 text-right tabular-nums"
                                      aria-label="Price"
                                    />
                                    <EditableNumber
                                      value={item.total_price}
                                      min={0}
                                      onCommit={(n) =>
                                        updateItem(
                                          item.key,
                                          { total_price: n },
                                          false
                                        )
                                      }
                                      className="h-9 px-2 text-right tabular-nums"
                                      aria-label="Total"
                                    />
                                  </>
                                ) : (
                                  <>
                                    <p className="text-center tabular-nums text-muted-foreground">
                                      ×{item.quantity}
                                    </p>
                                    <p className="text-right tabular-nums text-muted-foreground">
                                      {formatPHP(item.unit_price, currency)}
                                    </p>
                                    <p className="text-right font-medium tabular-nums">
                                      {formatPHP(item.total_price, currency)}
                                    </p>
                                  </>
                                )}
                              </div>

                              {canEdit ? (
                                <div className="flex flex-wrap items-center gap-2">
                                  <select
                                    className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-surface-elevated/60 px-2 text-xs"
                                    value={splitValue}
                                    onChange={(e) =>
                                      applySplitValue(item.key, e.target.value, splitN)
                                    }
                                  >
                                    <option value="one">1 person</option>
                                    <option value="number">N ways</option>
                                    <option value="group" disabled={!groupId}>
                                      Group
                                      {groupSize > 0 ? ` (${groupSize})` : ""}
                                    </option>
                                    <option value="claimers">Claimers</option>
                                  </select>
                                  {mode === "among_n" && splitN > 1 && (
                                    <EditableNumber
                                      value={splitN}
                                      min={2}
                                      onCommit={(n) =>
                                        updateItem(
                                          item.key,
                                          {
                                            split_mode: "among_n",
                                            split_n: Math.min(99, n),
                                          },
                                          false
                                        )
                                      }
                                      className="h-9 w-14 px-1.5 text-center tabular-nums"
                                      aria-label="Number of ways"
                                    />
                                  )}
                                  <SplitPerPersonHint
                                    total={item.total_price}
                                    mode={mode}
                                    splitN={splitN}
                                    groupSize={groupSize}
                                    currency={currency}
                                  />
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground">
                                  {mode === "among_group"
                                    ? groupSize > 0
                                      ? `Group (${groupSize}) · ${formatPHP(
                                          itemSplitPerPersonAmount(
                                            item.total_price,
                                            mode,
                                            splitN,
                                            groupSize
                                          ) ?? item.total_price,
                                          currency
                                        )}/ea`
                                      : `Group${groupSize ? ` (${groupSize})` : ""}`
                                    : mode === "among_claimers"
                                      ? "Claimers"
                                      : splitN <= 1
                                        ? "1 person"
                                        : `${splitN} ways`}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Desktop: compact table */}
                  <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
                    <table className="w-full min-w-[640px] border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                          {canEdit && <th className="w-10 px-3 py-2.5" />}
                          <th className="px-3 py-2.5 font-medium">Item</th>
                          <th className="w-[4.5rem] px-2 py-2.5 font-medium">Qty</th>
                          <th className="w-[6.5rem] px-2 py-2.5 font-medium">Price</th>
                          <th className="w-[6.5rem] px-2 py-2.5 font-medium">Total</th>
                          <th className="min-w-[11rem] px-3 py-2.5 font-medium">Split</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item) => {
                          const mode = item.split_mode ?? "among_n";
                          const splitN = item.split_n ?? 1;
                          const splitValue =
                            mode === "among_group"
                              ? "group"
                              : mode === "among_claimers"
                                ? "claimers"
                                : splitN <= 1
                                  ? "one"
                                  : "number";

                          return (
                            <tr
                              key={item.key}
                              className={cn(
                                "border-b border-border last:border-b-0",
                                item.selected && "bg-accent/40"
                              )}
                            >
                              {canEdit && (
                                <td className="px-3 py-2 align-middle">
                                  <input
                                    type="checkbox"
                                    className="block"
                                    checked={Boolean(item.selected)}
                                    onChange={(e) =>
                                      updateItem(
                                        item.key,
                                        { selected: e.target.checked },
                                        false
                                      )
                                    }
                                    aria-label={`Select ${item.name}`}
                                  />
                                </td>
                              )}
                              <td className="px-3 py-2 align-middle">
                                {canEdit ? (
                                  <Input
                                    value={item.name}
                                    onChange={(e) =>
                                      updateItem(
                                        item.key,
                                        { name: e.target.value },
                                        false
                                      )
                                    }
                                    className="h-9 border-transparent bg-transparent px-2 shadow-none focus-visible:border-input focus-visible:bg-surface-elevated/60"
                                  />
                                ) : (
                                  <span className="font-medium">{item.name}</span>
                                )}
                                {(item.sub_items?.length ?? 0) > 0 ? (
                                  <div className="mt-1">
                                    <EditorSubItems
                                      items={item.sub_items!}
                                      currency={currency}
                                    />
                                  </div>
                                ) : null}
                              </td>
                              <td className="px-2 py-2 align-middle">
                                {canEdit ? (
                                  <EditableNumber
                                    value={item.quantity}
                                    min={0.001}
                                    onCommit={(n) =>
                                      updateItem(item.key, { quantity: n })
                                    }
                                    className="h-9 px-2 text-center tabular-nums"
                                  />
                                ) : (
                                  <span className="block text-center tabular-nums">
                                    {item.quantity}
                                  </span>
                                )}
                              </td>
                              <td className="px-2 py-2 align-middle">
                                {canEdit ? (
                                  <EditableNumber
                                    value={item.unit_price}
                                    min={0}
                                    onCommit={(n) =>
                                      updateItem(item.key, { unit_price: n })
                                    }
                                    className="h-9 px-2 text-right tabular-nums"
                                  />
                                ) : (
                                  <span className="block text-right tabular-nums">
                                    {formatPHP(item.unit_price, currency)}
                                  </span>
                                )}
                              </td>
                              <td className="px-2 py-2 align-middle">
                                {canEdit ? (
                                  <EditableNumber
                                    value={item.total_price}
                                    min={0}
                                    onCommit={(n) =>
                                      updateItem(
                                        item.key,
                                        { total_price: n },
                                        false
                                      )
                                    }
                                    className="h-9 px-2 text-right tabular-nums"
                                  />
                                ) : (
                                  <span className="block text-right font-medium tabular-nums">
                                    {formatPHP(item.total_price, currency)}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 align-middle">
                                {canEdit ? (
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <select
                                      className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-surface-elevated/60 px-2 text-xs"
                                      value={splitValue}
                                      onChange={(e) =>
                                        applySplitValue(
                                          item.key,
                                          e.target.value,
                                          splitN
                                        )
                                      }
                                    >
                                      <option value="one">1 person</option>
                                      <option value="number">N ways</option>
                                      <option value="group" disabled={!groupId}>
                                        Group
                                        {groupSize > 0 ? ` (${groupSize})` : ""}
                                      </option>
                                      <option value="claimers">Claimers</option>
                                    </select>
                                    {mode === "among_n" && splitN > 1 && (
                                      <EditableNumber
                                        value={splitN}
                                        min={2}
                                        onCommit={(n) =>
                                          updateItem(
                                            item.key,
                                            {
                                              split_mode: "among_n",
                                              split_n: Math.min(99, n),
                                            },
                                            false
                                          )
                                        }
                                        className="h-9 w-14 px-1.5 text-center tabular-nums"
                                        aria-label="Number of ways"
                                      />
                                    )}
                                    <SplitPerPersonHint
                                      total={item.total_price}
                                      mode={mode}
                                      splitN={splitN}
                                      groupSize={groupSize}
                                      currency={currency}
                                    />
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">
                                    {mode === "among_group"
                                      ? groupSize > 0
                                        ? `Group (${groupSize}) · ${formatPHP(
                                            itemSplitPerPersonAmount(
                                              item.total_price,
                                              mode,
                                              splitN,
                                              groupSize
                                            ) ?? item.total_price,
                                            currency
                                          )}/ea`
                                        : `Group${groupSize ? ` (${groupSize})` : ""}`
                                      : mode === "among_claimers"
                                        ? "Claimers"
                                        : splitN <= 1
                                          ? "1 person"
                                          : `${splitN} ways`}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          {imageUrl && (
            <Card className="overflow-hidden">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 p-4">
                <div>
                  <CardTitle className="text-base">Receipt image</CardTitle>
                  <CardDescription className="text-xs">
                    {showEnhanced
                      ? "Enhanced for OCR (grayscale, contrast, sharpen)"
                      : "Original upload"}
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setShowEnhanced((v) => !v)}
                >
                  {showEnhanced ? "Original" : "Enhance"}
                </Button>
              </CardHeader>
              <CardContent className="relative p-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  key={showEnhanced ? "enhanced" : "original"}
                  src={
                    showEnhanced
                      ? `/api/receipts/${receiptId}/enhance`
                      : imageUrl
                  }
                  alt={showEnhanced ? "Enhanced receipt" : "Uploaded receipt"}
                  className="max-h-96 w-full object-contain bg-muted/30"
                />
                <ReceiptScanOverlay
                  active={reocr}
                  previewUrl={
                    showEnhanced
                      ? `/api/receipts/${receiptId}/enhance`
                      : imageUrl
                  }
                  compact
                  className="rounded-none bg-background/60"
                />
              </CardContent>
            </Card>
          )}

          {canEdit && (
            <Card>
              <CardHeader className="p-4">
                <CardTitle className="text-base">Adjustments</CardTitle>
                <CardDescription>
                  Amount due is the receipt total — tax/VAT is not added separately
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 p-4 pt-0">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label>Discounts</Label>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 px-2 text-xs"
                      onClick={addDiscount}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add
                    </Button>
                  </div>
                  {discounts.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border px-2 py-3 text-xs text-muted-foreground">
                      No discounts — tap Add for promos, senior/PWD, etc.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {discounts.map((row) => (
                        <div key={row.key} className="space-y-1.5 rounded-lg border border-border p-2">
                          <Input
                            value={row.label}
                            onChange={(e) =>
                              updateDiscount(row.key, { label: e.target.value })
                            }
                            placeholder="e.g. Senior, Promo"
                            className="h-9 text-sm"
                          />
                          <div className="flex items-center gap-1.5">
                            <EditableNumber
                              value={row.amount}
                              min={0}
                              onCommit={(amount) => updateDiscount(row.key, { amount })}
                              className="h-9 flex-1"
                              aria-label={`${row.label} amount`}
                            />
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-9 w-9 shrink-0 text-destructive hover:text-destructive"
                              onClick={() => removeDiscount(row.key)}
                              aria-label={`Remove ${row.label}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Service charge</Label>
                  <EditableNumber
                    value={serviceCharge}
                    min={0}
                    onCommit={setServiceCharge}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Tip</Label>
                  <EditableNumber value={tip} min={0} onCommit={setTip} />
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="p-4">
              <CardTitle className="text-base">Totals</CardTitle>
              <CardDescription>
                {canEdit ? "Based on line items + adjustments" : "From the uploaded receipt"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 p-4 pt-0 text-sm">
              <Row label="Items" value={formatPHP(totals.itemsSubtotal, currency)} />
              {discountTotal > 0 &&
                (discounts.length === 1 ? (
                  <Row
                    label={discounts[0]?.label || "Discount"}
                    value={`−${formatPHP(totals.discount, currency)}`}
                  />
                ) : (
                  <>
                    {discounts.map((row) => (
                      <Row
                        key={row.key}
                        label={row.label}
                        value={`−${formatPHP(row.amount, currency)}`}
                      />
                    ))}
                    <Row
                      label="Total discounts"
                      value={`−${formatPHP(totals.discount, currency)}`}
                    />
                  </>
                ))}
              {serviceCharge > 0 && (
                <Row label="Service" value={formatPHP(totals.serviceCharge, currency)} />
              )}
              {tip > 0 && (
                <Row label="Tip" value={formatPHP(totals.tip, currency)} />
              )}
              <div className="flex items-center justify-between border-t border-border pt-3 text-base font-semibold">
                <span>Amount due</span>
                <span>{formatPHP(totals.total, currency)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SplitPerPersonHint({
  total,
  mode,
  splitN,
  groupSize,
  currency,
}: {
  total: number;
  mode: EditorItem["split_mode"];
  splitN: number;
  groupSize: number;
  currency: string;
}) {
  const perPerson = itemSplitPerPersonAmount(
    total,
    mode ?? "among_n",
    splitN,
    groupSize
  );
  if (perPerson == null) return null;
  return (
    <span className="whitespace-nowrap text-[11px] text-muted-foreground">
      {formatPHP(perPerson, currency)}/ea
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

/** Allows clearing a number field while typing; commits 0 (or min) on blur if empty. */
function EditableNumber({
  value,
  onCommit,
  min,
  className,
  id,
  "aria-label": ariaLabel,
}: {
  value: number;
  onCommit: (n: number) => void;
  min?: number;
  className?: string;
  id?: string;
  "aria-label"?: string;
}) {
  const [text, setText] = useState(() => String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);

  function commit(raw: string) {
    const n = Number(raw);
    let next = raw === "" || Number.isNaN(n) ? (min ?? 0) : n;
    if (min != null && next < min) next = min;
    setText(String(next));
    onCommit(next);
  }

  return (
    <Input
      id={id}
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      className={className}
      value={text}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw !== "" && !/^\d*\.?\d*$/.test(raw)) return;
        setText(raw);
        if (raw !== "" && raw !== ".") {
          const n = Number(raw);
          if (!Number.isNaN(n)) {
            if (min == null || n >= min) onCommit(n);
          }
        }
      }}
      onBlur={() => {
        focused.current = false;
        commit(text);
      }}
    />
  );
}
