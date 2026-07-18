"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { computeReceiptTotals, formatPHP, lineTotal, moneyNumber } from "@/lib/money";
import { cn } from "@/utils/cn";

export type EditorItem = {
  key: string;
  id?: string;
  name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  selected?: boolean;
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
  };
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    unit_price: number;
    total_price: number;
    sort_order: number;
  }>;
  imageUrl: string | null;
  history: Array<{ id: string; event: string; created_at: string }>;
};

function uid() {
  return crypto.randomUUID();
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
  const [tax, setTax] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [serviceCharge, setServiceCharge] = useState(0);
  const [tip, setTip] = useState(0);
  const [currency, setCurrency] = useState("PHP");
  const [status, setStatus] = useState("draft");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [items, setItems] = useState<EditorItem[]>([]);
  const [history, setHistory] = useState<ReceiptPayload["history"]>([]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/receipts/${receiptId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load");
      const data = json.data as ReceiptPayload;
      setMerchant(data.receipt.merchant ?? "");
      setDate(data.receipt.receipt_date ?? "");
      setTime((data.receipt.receipt_time ?? "").slice(0, 5));
      setNotes(data.receipt.notes ?? "");
      setTax(Number(data.receipt.tax));
      setDiscount(Number(data.receipt.discount));
      setServiceCharge(Number(data.receipt.service_charge));
      setTip(Number(data.receipt.tip));
      setCurrency(data.receipt.currency ?? "PHP");
      setStatus(data.receipt.status);
      setConfidence(data.receipt.ocr_confidence);
      setImageUrl(data.imageUrl);
      setHistory(data.history ?? []);
      setItems(
        (data.items ?? []).map((i) => ({
          key: i.id,
          id: i.id,
          name: i.name,
          quantity: Number(i.quantity),
          unit_price: Number(i.unit_price),
          total_price: Number(i.total_price),
          selected: false,
        }))
      );
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

  const totals = useMemo(
    () =>
      computeReceiptTotals({
        items: items.map((i) => ({
          quantity: i.quantity,
          unitPrice: i.unit_price,
          totalPrice: i.total_price,
        })),
        tax,
        discount,
        serviceCharge,
        tip,
      }),
    [items, tax, discount, serviceCharge, tip]
  );

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
    };
    const b: EditorItem = {
      key: uid(),
      name: `${item.name} (2)`,
      quantity: moneyNumber(item.quantity - halfQty),
      unit_price: item.unit_price,
      total_price: lineTotal(item.quantity - halfQty, item.unit_price),
    };
    setItems((prev) => [...prev.filter((i) => i.key !== item.key), a, b]);
  }

  async function save(finalize = false) {
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
          tax,
          discount,
          service_charge: serviceCharge,
          tip,
          status: finalize ? "finalized" : "edited",
          items: items.map((i, index) => ({
            name: i.name,
            quantity: i.quantity,
            unit_price: i.unit_price,
            total_price: i.total_price,
            sort_order: index,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Save failed");
      toast.success(finalize ? "Receipt finalized" : "Changes saved");
      setStatus(finalize ? "finalized" : "edited");
      if (finalize) router.push("/receipts");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function rerunOcr() {
    setReocr(true);
    try {
      const res = await fetch(`/api/ocr/${receiptId}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "OCR failed");
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
            href="/receipts"
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> All receipts
          </Link>
          <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">
            {merchant || "Untitled receipt"}
          </h1>
          <p className="mt-1 text-sm capitalize text-muted-foreground">
            {status.replaceAll("_", " ")}
            {confidence != null ? ` · OCR ${confidence}%` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void rerunOcr()} disabled={reocr}>
            {reocr ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Re-run OCR
          </Button>
          <Button variant="outline" size="sm" onClick={() => void save(false)} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            Save
          </Button>
          <Button size="sm" onClick={() => void save(true)} disabled={saving}>
            <CheckCircle2 /> Finalize
          </Button>
        </div>
      </div>

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
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="date">Date</Label>
                <Input
                  id="date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="time">Time</Label>
                <Input
                  id="time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-col gap-3 space-y-0 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <div>
                <CardTitle className="text-base sm:text-lg">Line items</CardTitle>
                <CardDescription>Edit OCR mistakes — totals update instantly</CardDescription>
              </div>
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
            </CardHeader>
            <CardContent className="p-0 sm:p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-y border-border bg-muted/40 text-left text-xs text-muted-foreground">
                      <th className="w-10 px-3 py-2" />
                      <th className="px-3 py-2 font-medium">Item</th>
                      <th className="w-24 px-3 py-2 font-medium">Qty</th>
                      <th className="w-28 px-3 py-2 font-medium">Price</th>
                      <th className="w-28 px-3 py-2 font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                          No items — add one or re-run OCR.
                        </td>
                      </tr>
                    ) : (
                      items.map((item) => (
                        <tr
                          key={item.key}
                          className={cn(
                            "border-b border-border",
                            item.selected && "bg-accent/30"
                          )}
                        >
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={Boolean(item.selected)}
                              onChange={(e) =>
                                updateItem(item.key, { selected: e.target.checked }, false)
                              }
                              aria-label={`Select ${item.name}`}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              value={item.name}
                              onChange={(e) =>
                                updateItem(item.key, { name: e.target.value }, false)
                              }
                              className="h-9"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              type="number"
                              step="0.001"
                              min="0.001"
                              value={item.quantity}
                              onChange={(e) =>
                                updateItem(item.key, {
                                  quantity: Number(e.target.value) || 0,
                                })
                              }
                              className="h-9"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              value={item.unit_price}
                              onChange={(e) =>
                                updateItem(item.key, {
                                  unit_price: Number(e.target.value) || 0,
                                })
                              }
                              className="h-9"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              value={item.total_price}
                              onChange={(e) =>
                                updateItem(
                                  item.key,
                                  { total_price: Number(e.target.value) || 0 },
                                  false
                                )
                              }
                              className="h-9"
                            />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          {imageUrl && (
            <Card className="overflow-hidden">
              <CardHeader className="p-4">
                <CardTitle className="text-base">Receipt image</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl}
                  alt="Uploaded receipt"
                  className="max-h-72 w-full object-contain bg-muted/30"
                />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="p-4">
              <CardTitle className="text-base">Adjustments</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 p-4 pt-0">
              {(
                [
                  ["Tax / VAT", tax, setTax],
                  ["Discount", discount, setDiscount],
                  ["Service charge", serviceCharge, setServiceCharge],
                  ["Tip", tip, setTip],
                ] as const
              ).map(([label, value, setter]) => (
                <div key={label} className="space-y-1.5">
                  <Label>{label}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={value}
                    onChange={(e) => setter(Number(e.target.value) || 0)}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-4">
              <CardTitle className="text-base">Totals</CardTitle>
              <CardDescription>Decimal-safe calculation</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 p-4 pt-0 text-sm">
              <Row label="Items" value={formatPHP(totals.itemsSubtotal, currency)} />
              <Row label="Tax" value={formatPHP(totals.tax, currency)} />
              <Row label="Discount" value={`−${formatPHP(totals.discount, currency)}`} />
              <Row label="Service" value={formatPHP(totals.serviceCharge, currency)} />
              <Row label="Tip" value={formatPHP(totals.tip, currency)} />
              <div className="flex items-center justify-between border-t border-border pt-3 text-base font-semibold">
                <span>Grand total</span>
                <span>{formatPHP(totals.total, currency)}</span>
              </div>
            </CardContent>
          </Card>

          {history.length > 0 && (
            <Card>
              <CardHeader className="p-4">
                <CardTitle className="text-base">Timeline</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 p-4 pt-0 text-xs text-muted-foreground">
                {history.map((h) => (
                  <div key={h.id} className="flex justify-between gap-2">
                    <span className="capitalize">{h.event.replaceAll("_", " ")}</span>
                    <span>{new Date(h.created_at).toLocaleString()}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
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
