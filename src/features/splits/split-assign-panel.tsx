"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Save, Hand, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPHP } from "@/lib/money";
import {
  normalizePaymentMethods,
  paymentMethodCopyText,
  paymentMethodDisplayLabel,
  type PaymentMethod,
} from "@/lib/payment-methods";
import {
  computeOwesToPayer,
  computeSplitBalances,
  type AssignmentInput,
  type SplitMethod,
} from "@/lib/splits";
import { useReceiptRealtime } from "@/hooks/use-realtime";
import { cn } from "@/utils/cn";

type Member = {
  id: string;
  user_id: string | null;
  guest_name: string | null;
  guest_email?: string | null;
  profiles: {
    full_name: string | null;
    username: string | null;
    payment_methods?: PaymentMethod[] | null;
  } | null;
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

export function SplitAssignPanel({
  receiptId,
  currentUserId,
}: {
  receiptId: string;
  currentUserId?: string | null;
}) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [groupId, setGroupId] = useState<string>("");
  const [paidByMemberId, setPaidByMemberId] = useState<string>("");
  const [settlementNote, setSettlementNote] = useState("");
  const [localAssignments, setLocalAssignments] = useState<Record<string, string[]>>(
    {}
  );
  const [method, setMethod] = useState<SplitMethod>("equal");
  const [mode, setMode] = useState<"assign" | "claim">("claim");

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
          paid_by_member_id?: string | null;
          settlement_note?: string | null;
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

  const myMemberId = useMemo(() => {
    if (!data || !currentUserId) return null;
    return data.members.find((m) => m.user_id === currentUserId)?.id ?? null;
  }, [data, currentUserId]);

  useEffect(() => {
    if (!data) return;
    if (data.receipt.group_id) setGroupId(data.receipt.group_id);
    if (data.receipt.paid_by_member_id) {
      setPaidByMemberId(data.receipt.paid_by_member_id);
    }
    setSettlementNote(data.receipt.settlement_note ?? "");
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

  const owes = useMemo(() => {
    if (!liveSummary || !paidByMemberId) return [];
    return computeOwesToPayer(liveSummary, paidByMemberId);
  }, [liveSummary, paidByMemberId]);

  function toggleMember(itemId: string, memberId: string) {
    setLocalAssignments((prev) => {
      const cur = prev[itemId] ?? [];
      const next = cur.includes(memberId)
        ? cur.filter((id) => id !== memberId)
        : [...cur, memberId];
      return { ...prev, [itemId]: next };
    });
  }

  function claimItem(itemId: string) {
    if (!myMemberId) {
      toast.error("Join the group on this receipt first");
      return;
    }
    toggleMember(itemId, myMemberId);
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
          paid_by_member_id: paidByMemberId || null,
          settlement_note: settlementNote.trim() || null,
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
  const payer = data.members.find((m) => m.id === paidByMemberId);
  const payerMethods = normalizePaymentMethods(payer?.profiles?.payment_methods);
  const myOwe = owes.find((o) => o.fromMemberId === myMemberId);

  async function copyDetails(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy");
    }
  }

  return (
    <Card>
      <CardHeader className="p-4 sm:p-6">
        <CardTitle className="text-base sm:text-lg">Split the bill</CardTitle>
        <CardDescription>
          Tap what you ordered. Choose who paid so everyone knows whom — and where — to
          pay back.
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
            <Label>Who paid the bill?</Label>
            <select
              className="flex h-11 w-full rounded-xl border border-input bg-surface-elevated/60 px-3 text-sm"
              value={paidByMemberId}
              onChange={(e) => setPaidByMemberId(e.target.value)}
              disabled={!groupId || data.members.length === 0}
            >
              <option value="">Select payer…</option>
              {data.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {memberLabel(m)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {paidByMemberId && (
          <div className="space-y-2">
            <Label htmlFor="settlement-note">Where to pay (this bill)</Label>
            <Input
              id="settlement-note"
              value={settlementNote}
              onChange={(e) => setSettlementNote(e.target.value)}
              placeholder="e.g. GCash 0917… · name on account"
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground">
              Optional note for this receipt. Payers can also set defaults in Settings →
              Payout.
            </p>
          </div>
        )}

        {!groupId || data.members.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Link a group with members first. Add friends or invite guests from the group
            page, then come back.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={mode === "claim" ? "default" : "outline"}
                onClick={() => setMode("claim")}
              >
                <Hand className="h-3.5 w-3.5" />
                Tap what I got
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "assign" ? "default" : "outline"}
                onClick={() => setMode("assign")}
              >
                Assign for everyone
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={assignAllToEveryone}>
                Share all equally
              </Button>
            </div>

            <div className="space-y-2">
              <Label>Split method (when shared)</Label>
              <select
                className="flex h-11 w-full max-w-xs rounded-xl border border-input bg-surface-elevated/60 px-3 text-sm"
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

            {mode === "claim" && !myMemberId && (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                You need to be a member of this group to claim items.
              </p>
            )}

            <div className="space-y-3">
              {data.items.map((item) => {
                const assignees = localAssignments[item.id] ?? [];
                const iClaimed = myMemberId ? assignees.includes(myMemberId) : false;
                return (
                  <div key={item.id} className="rounded-2xl border border-border p-3">
                    <button
                      type="button"
                      onClick={() =>
                        mode === "claim" ? claimItem(item.id) : undefined
                      }
                      className={cn(
                        "mb-2 flex w-full items-center justify-between gap-2 text-left text-sm",
                        mode === "claim" && "rounded-xl p-1 transition hover:bg-muted/50"
                      )}
                    >
                      <span className="font-medium">
                        {mode === "claim" && (iClaimed ? "✓ " : "")}
                        {item.name}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatPHP(item.total_price, currency)}
                      </span>
                    </button>

                    {mode === "claim" ? (
                      <p className="text-xs text-muted-foreground">
                        {assignees.length === 0
                          ? "Nobody claimed yet — tap the item if it’s yours"
                          : `Claimed by: ${assignees
                              .map((id) => {
                                const m = data.members.find((x) => x.id === id);
                                return m ? memberLabel(m) : "?";
                              })
                              .join(", ")}`}
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {data.members.map((m) => {
                          const active = assignees.includes(m.id);
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
                    )}
                  </div>
                );
              })}
            </div>

            {liveSummary && (
              <div className="space-y-4 rounded-2xl bg-muted/40 p-4 text-sm">
                <div>
                  <p className="mb-3 font-medium">Each person&apos;s share</p>
                  <ul className="space-y-2">
                    {liveSummary.members.map((m) => {
                      const meta = data.members.find((x) => x.id === m.memberId);
                      return (
                        <li key={m.memberId} className="flex justify-between gap-3">
                          <span>
                            {meta ? memberLabel(meta) : m.memberId.slice(0, 8)}
                            {m.memberId === paidByMemberId ? " (paid)" : ""}
                          </span>
                          <span className="font-semibold tabular-nums">
                            {formatPHP(m.total, currency)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {paidByMemberId && (owes.length > 0 || payerMethods.length > 0 || settlementNote) && (
                  <div className="space-y-3 border-t border-border pt-3">
                    <p className="font-medium">
                      Pay back {payer ? memberLabel(payer) : "payer"}
                    </p>

                    {(settlementNote.trim() || payerMethods.length > 0) && (
                      <div className="space-y-2 rounded-xl bg-background/60 p-3">
                        <p className="text-xs font-medium text-muted-foreground">
                          Where to send payment
                        </p>
                        {settlementNote.trim() && (
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm">{settlementNote.trim()}</p>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              onClick={() => void copyDetails(settlementNote.trim())}
                              aria-label="Copy payment note"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                        {payerMethods.map((m) => (
                          <div
                            key={m.id}
                            className="space-y-2 rounded-lg border border-border/60 p-2"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 space-y-0.5">
                                <p className="text-xs text-muted-foreground">
                                  {paymentMethodDisplayLabel(m)}
                                </p>
                                {m.account_name ? (
                                  <p className="text-sm font-medium">{m.account_name}</p>
                                ) : null}
                                {m.account_number ? (
                                  <p className="font-medium tabular-nums">
                                    {m.account_number}
                                  </p>
                                ) : null}
                              </div>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                onClick={() => void copyDetails(paymentMethodCopyText(m))}
                                aria-label={`Copy ${paymentMethodDisplayLabel(m)}`}
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                            {m.qr_code_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={m.qr_code_url}
                                alt={`Pay ${m.account_name || paymentMethodDisplayLabel(m)} QR`}
                                className="mx-auto h-36 w-36 rounded-xl border border-border bg-white object-contain p-2"
                              />
                            ) : null}
                          </div>
                        ))}
                        {!settlementNote.trim() && payerMethods.length === 0 && (
                          <p className="text-xs text-muted-foreground">
                            No payout details yet
                            {payer?.guest_email
                              ? ` — ask ${payer.guest_email}`
                              : ". Ask the payer, or add a note above."}
                          </p>
                        )}
                      </div>
                    )}

                    {myOwe && (
                      <p className="rounded-xl bg-primary/10 px-3 py-2 text-sm font-medium">
                        You owe {formatPHP(myOwe.amount, currency)}
                        {payer ? ` to ${memberLabel(payer)}` : ""}
                      </p>
                    )}

                    {owes.length > 0 && (
                      <ul className="space-y-2">
                        {owes.map((o) => {
                          const from = data.members.find((x) => x.id === o.fromMemberId);
                          return (
                            <li
                              key={o.fromMemberId}
                              className="flex justify-between gap-3 text-muted-foreground"
                            >
                              <span>{from ? memberLabel(from) : "Member"}</span>
                              <span className="font-semibold tabular-nums text-foreground">
                                {formatPHP(o.amount, currency)}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}

                {liveSummary.unassignedTotal > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Unassigned: {formatPHP(liveSummary.unassignedTotal, currency)}
                  </p>
                )}
                <div className="flex justify-between border-t border-border pt-3 font-semibold">
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
