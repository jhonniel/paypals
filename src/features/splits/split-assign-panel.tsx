"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPHP } from "@/lib/money";
import { computeSplitBalances, type AssignmentInput, type SplitMethod } from "@/lib/splits";
import { useReceiptRealtime } from "@/hooks/use-realtime";
import { cn } from "@/utils/cn";

type Member = {
  id: string;
  guest_name: string | null;
  profiles: { full_name: string | null; username: string | null } | null;
};

type Item = {
  id: string;
  name: string;
  quantity: number;
  total_price: number;
};

type AssignmentRow = {
  receipt_item_id: string;
  member_id: string;
  split_method: SplitMethod;
  share_percentage: number | null;
  share_quantity: number | null;
  share_amount: number | null;
};

function memberLabel(m: Member) {
  return m.profiles?.full_name || m.profiles?.username || m.guest_name || "Member";
}

export function SplitAssignPanel({ receiptId }: { receiptId: string }) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [groupId, setGroupId] = useState<string>("");
  const [localAssignments, setLocalAssignments] = useState<
    Record<string, string[]>
  >({});
  const [method, setMethod] = useState<SplitMethod>("equal");

  useReceiptRealtime(receiptId, () => {
    void qc.invalidateQueries({ queryKey: ["assignments", receiptId] });
  });

  const { data: groups } = useQuery({
    queryKey: ["groups"],
    queryFn: async () => {
      const res = await fetch("/api/groups");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message);
      return json.data as Array<{ id: string; name: string }>;
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["assignments", receiptId],
    queryFn: async () => {
      const res = await fetch(`/api/receipts/${receiptId}/assignments`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed");
      return json.data as {
        receipt: {
          group_id: string | null;
          tax: number;
          discount: number;
          service_charge: number;
          tip: number;
          currency: string;
        };
        items: Item[];
        assignments: AssignmentRow[];
        members: Member[];
        summary: ReturnType<typeof computeSplitBalances>;
      };
    },
  });

  // Sync local state when data loads
  useEffect(() => {
    if (!data) return;
    if (data.receipt.group_id) setGroupId(data.receipt.group_id);
    const map: Record<string, string[]> = {};
    for (const item of data.items) {
      map[item.id] = data.assignments
        .filter((a) => a.receipt_item_id === item.id)
        .map((a) => a.member_id);
    }
    setLocalAssignments(map);
  }, [data]);

  const liveSummary = useMemo(() => {
    if (!data) return null;
    const items = data.items.map((item) => {
      const memberIds = localAssignments[item.id] ?? [];
      const assignments: AssignmentInput[] = memberIds.map((memberId) => ({
        memberId,
        splitMethod: method,
        sharePercentage: method === "percentage" ? 100 / Math.max(memberIds.length, 1) : null,
        shareQuantity:
          method === "quantity"
            ? Number(item.quantity) / Math.max(memberIds.length, 1)
            : null,
        shareAmount:
          method === "custom"
            ? Number(item.total_price) / Math.max(memberIds.length, 1)
            : null,
        weight: 1,
      }));
      return {
        itemId: item.id,
        itemName: item.name,
        itemTotal: Number(item.total_price),
        itemQuantity: Number(item.quantity),
        assignments,
      };
    });
    return computeSplitBalances(items, {
      tax: Number(data.receipt.tax),
      discount: Number(data.receipt.discount),
      serviceCharge: Number(data.receipt.service_charge),
      tip: Number(data.receipt.tip),
    });
  }, [data, localAssignments, method]);

  function toggleMember(itemId: string, memberId: string) {
    setLocalAssignments((prev) => {
      const cur = prev[itemId] ?? [];
      const next = cur.includes(memberId)
        ? cur.filter((id) => id !== memberId)
        : [...cur, memberId];
      return { ...prev, [itemId]: next };
    });
  }

  function assignAllToEveryone() {
    if (!data) return;
    const allIds = data.members.map((m) => m.id);
    const map: Record<string, string[]> = {};
    data.items.forEach((item) => {
      map[item.id] = [...allIds];
    });
    setLocalAssignments(map);
  }

  async function save() {
    if (!data) return;
    setSaving(true);
    try {
      const assignments: AssignmentRow[] = [];
      for (const item of data.items) {
        const memberIds = localAssignments[item.id] ?? [];
        for (const memberId of memberIds) {
          assignments.push({
            receipt_item_id: item.id,
            member_id: memberId,
            split_method: method,
            share_percentage:
              method === "percentage" ? 100 / Math.max(memberIds.length, 1) : null,
            share_quantity:
              method === "quantity"
                ? Number(item.quantity) / Math.max(memberIds.length, 1)
                : null,
            share_amount:
              method === "custom"
                ? Number(item.total_price) / Math.max(memberIds.length, 1)
                : null,
          });
        }
      }

      const res = await fetch(`/api/receipts/${receiptId}/assignments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          group_id: groupId || null,
          assignments,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Save failed");
      toast.success("Split saved");
      await qc.invalidateQueries({ queryKey: ["assignments", receiptId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading || !data) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Loading split…
        </CardContent>
      </Card>
    );
  }

  const currency = data.receipt.currency ?? "PHP";

  return (
    <Card>
      <CardHeader className="p-4 sm:p-6">
        <CardTitle className="text-base sm:text-lg">Split with group</CardTitle>
        <CardDescription>
          Assign each item to members — totals update live (Decimal-safe).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 p-4 pt-0 sm:p-6 sm:pt-0">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Group</Label>
            <select
              className="flex h-11 w-full rounded-xl border border-input bg-surface-elevated/60 px-3 text-sm"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
            >
              <option value="">Select a group…</option>
              {(groups ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label>Split method</Label>
            <select
              className="flex h-11 w-full rounded-xl border border-input bg-surface-elevated/60 px-3 text-sm"
              value={method}
              onChange={(e) => setMethod(e.target.value as SplitMethod)}
            >
              <option value="equal">Equal</option>
              <option value="percentage">Percentage</option>
              <option value="quantity">By quantity</option>
              <option value="weighted">Weighted</option>
              <option value="custom">Custom amount</option>
            </select>
          </div>
        </div>

        {!groupId || data.members.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Link a group with members to assign items. Create one under Groups, then
            refresh.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={assignAllToEveryone}>
                Share all equally
              </Button>
            </div>

            <div className="space-y-3">
              {data.items.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-border p-3"
                >
                  <div className="mb-2 flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium">{item.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatPHP(item.total_price, currency)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {data.members.map((m) => {
                      const active = (localAssignments[item.id] ?? []).includes(m.id);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => toggleMember(item.id, m.id)}
                          className={cn(
                            "rounded-full px-3 py-1 text-xs font-medium transition",
                            active
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
                          )}
                        >
                          {memberLabel(m)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {liveSummary && (
              <div className="rounded-2xl bg-muted/40 p-4 text-sm">
                <p className="mb-3 font-medium">Who owes what</p>
                <ul className="space-y-2">
                  {liveSummary.members.map((m) => {
                    const meta = data.members.find((x) => x.id === m.memberId);
                    return (
                      <li key={m.memberId} className="flex justify-between gap-3">
                        <span>{meta ? memberLabel(meta) : m.memberId.slice(0, 8)}</span>
                        <span className="font-semibold tabular-nums">
                          {formatPHP(m.total, currency)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {liveSummary.unassignedTotal > 0 && (
                  <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
                    Unassigned: {formatPHP(liveSummary.unassignedTotal, currency)}
                  </p>
                )}
                <div className="mt-3 flex justify-between border-t border-border pt-3 font-semibold">
                  <span>Grand total</span>
                  <span>{formatPHP(liveSummary.grandTotal, currency)}</span>
                </div>
              </div>
            )}

            <Button className="w-full" onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              Save split
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
