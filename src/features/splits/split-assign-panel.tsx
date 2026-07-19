"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPHP } from "@/lib/money";
import {
  normalizePaymentMethods,
  paymentMethodCopyText,
  paymentMethodDisplayLabel,
  toSharedPaymentMethods,
  type PaymentMethod,
} from "@/lib/payment-methods";
import {
  computeOwesToPayer,
  computeSplitBalances,
  type AssignmentInput,
  type ItemSplitMode,
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
  split_mode?: ItemSplitMode | null;
  split_n?: number | null;
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
  const [localAssignments, setLocalAssignments] = useState<Record<string, string[]>>(
    {}
  );
  const [itemSplits, setItemSplits] = useState<
    Record<string, { mode: ItemSplitMode; n: number }>
  >({});
  const method: SplitMethod = "equal";

  useReceiptRealtime(receiptId, () => {
    void qc.invalidateQueries({ queryKey: ["assignments", receiptId] });
  });

  const { data: groups } = useQuery({
    queryKey: ["groups"],
    queryFn: async () => {
      const res = await fetch("/api/groups");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message);
      return json.data as Array<{
        id: string;
        name: string;
        created_by?: string;
        my_role?: string;
      }>;
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
          created_by?: string;
          group_id: string | null;
          paid_by_member_id?: string | null;
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

  const canManageSplit = Boolean(
    currentUserId && data?.receipt.created_by === currentUserId
  );

  const creatableGroups = useMemo(() => {
    if (!groups || !currentUserId) return groups ?? [];
    return groups.filter(
      (g) =>
        g.my_role === "owner" ||
        g.created_by === currentUserId ||
        !g.created_by
    );
  }, [groups, currentUserId]);

  useEffect(() => {
    if (!data) return;
    if (data.receipt.group_id) setGroupId(data.receipt.group_id);
    if (data.receipt.paid_by_member_id) {
      setPaidByMemberId(data.receipt.paid_by_member_id);
    } else {
      setPaidByMemberId((prev) => {
        if (prev) return prev;
        const me = data.members.find((m) => m.user_id === currentUserId);
        return me?.id ?? "";
      });
    }
    const map: Record<string, string[]> = {};
    const splits: Record<string, { mode: ItemSplitMode; n: number }> = {};
    for (const item of data.items) {
      map[item.id] = data.assignments
        .filter((a) => a.receipt_item_id === item.id)
        .map((a) => a.member_id);
      splits[item.id] = {
        mode: (item.split_mode ?? "among_n") as ItemSplitMode,
        n: item.split_n ?? 1,
      };
    }
    setLocalAssignments(map);
    setItemSplits(splits);
  }, [data, currentUserId]);

  const liveSummary = useMemo(() => {
    if (!data) return null;
    const groupMemberIds = data.members.map((m) => m.id);
    const items = data.items.map((item) => {
      const cfg = itemSplits[item.id] ?? {
        mode: (item.split_mode ?? "among_n") as ItemSplitMode,
        n: item.split_n ?? 1,
      };
      const memberIds =
        cfg.mode === "among_group"
          ? groupMemberIds
          : (localAssignments[item.id] ?? []);
      const divisor =
        cfg.mode === "among_n"
          ? Math.max(cfg.n, 1)
          : Math.max(memberIds.length, 1);
      const assignments: AssignmentInput[] = memberIds.map((memberId) => ({
        memberId,
        splitMethod: method,
        sharePercentage: method === "percentage" ? 100 / divisor : null,
        shareQuantity:
          method === "quantity" ? Number(item.quantity) / divisor : null,
        shareAmount:
          method === "custom" ? Number(item.total_price) / divisor : null,
        weight: 1,
      }));
      return {
        itemId: item.id,
        itemName: item.name,
        itemTotal: Number(item.total_price),
        itemQuantity: Number(item.quantity),
        splitMode: cfg.mode,
        splitN: cfg.n,
        assignments,
      };
    });
    return computeSplitBalances(
      items,
      {
        tax: Number(data.receipt.tax),
        discount: Number(data.receipt.discount),
        serviceCharge: Number(data.receipt.service_charge),
        tip: Number(data.receipt.tip),
      },
      {
        equalServiceChargeMemberIds: groupMemberIds,
        groupMemberIds,
      }
    );
  }, [data, localAssignments, method, itemSplits]);

  const owes = useMemo(() => {
    if (!liveSummary || !paidByMemberId) return [];
    return computeOwesToPayer(liveSummary, paidByMemberId);
  }, [liveSummary, paidByMemberId]);

  const membersWithShare = liveSummary?.members.filter((m) => m.total > 0) ?? [];
  const hasShares = membersWithShare.length > 0;
  const partialUnassigned =
    !!liveSummary &&
    liveSummary.unassignedTotal > 0 &&
    liveSummary.unassignedTotal < liveSummary.grandTotal;

  function buildAssignments(
    map: Record<string, string[]>,
    onlyMemberId?: string | null
  ): AssignmentRow[] {
    if (!data) return [];
    const assignments: AssignmentRow[] = [];
    for (const item of data.items) {
      const memberIds = map[item.id] ?? [];
      for (const memberId of memberIds) {
        if (onlyMemberId && memberId !== onlyMemberId) continue;
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
    return assignments;
  }

  async function persistAssignments(
    map: Record<string, string[]>,
    opts?: {
      quiet?: boolean;
      claimed?: boolean;
      paidBy?: string;
    }
  ) {
    if (!data) return;
    setSaving(true);
    try {
      const paidBy = opts?.paidBy ?? paidByMemberId;
      const body = canManageSplit
        ? {
            group_id: groupId || null,
            paid_by_member_id: paidBy || null,
            assignments: buildAssignments(map),
          }
        : {
            assignments: buildAssignments(map, myMemberId),
          };

      const res = await fetch(`/api/receipts/${receiptId}/assignments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Save failed");
      if (!opts?.quiet) {
        toast.success(canManageSplit ? "Split saved" : "Saved");
      } else if (opts.claimed !== undefined) {
        toast.success(opts.claimed ? "Claimed" : "Unclaimed");
      }
      await qc.invalidateQueries({ queryKey: ["assignments", receiptId] });
      if (groupId) {
        await qc.invalidateQueries({ queryKey: ["group", groupId] });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
      await qc.invalidateQueries({ queryKey: ["assignments", receiptId] });
    } finally {
      setSaving(false);
    }
  }

  async function linkGroup(nextGroupId: string) {
    if (!canManageSplit) return;
    setGroupId(nextGroupId);
    setPaidByMemberId("");
    try {
      const res = await fetch(`/api/receipts/${receiptId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: nextGroupId || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Could not link group");
      toast.success(
        nextGroupId
          ? "Receipt linked to group — details appear on the group page"
          : "Receipt unlinked from group"
      );
      await qc.invalidateQueries({ queryKey: ["assignments", receiptId] });
      if (nextGroupId) {
        await qc.invalidateQueries({ queryKey: ["group", nextGroupId] });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not link group");
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
  const payerMethods = toSharedPaymentMethods(
    normalizePaymentMethods(payer?.profiles?.payment_methods)
  );
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
    <Card id="split">
      <CardHeader className="p-4 sm:p-6">
        <CardTitle className="text-base sm:text-lg">Split the bill</CardTitle>
        <CardDescription>
          {canManageSplit
            ? "Choose who paid. Their receiving accounts show on the group page."
            : "See your share and the payer’s receiving accounts on the group page."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 p-4 pt-0 sm:p-6 sm:pt-0">
        {canManageSplit ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Group</Label>
              <select
                className="flex h-11 w-full rounded-xl border border-input bg-surface-elevated/60 px-3 text-sm"
                value={groupId}
                onChange={(e) => void linkGroup(e.target.value)}
              >
                <option value="">Select a group…</option>
                {creatableGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Who paid the bill?</Label>
              <select
                className="flex h-11 w-full rounded-xl border border-input bg-surface-elevated/60 px-3 text-sm disabled:opacity-60"
                value={paidByMemberId}
                onChange={(e) => {
                  const next = e.target.value;
                  setPaidByMemberId(next);
                  if (canManageSplit) {
                    void persistAssignments(localAssignments, {
                      quiet: true,
                      paidBy: next,
                    });
                  }
                }}
                disabled={!groupId || data.members.length === 0}
              >
                <option value="">
                  {!groupId
                    ? "Link a group first…"
                    : data.members.length === 0
                      ? "No members in this group…"
                      : "Select payer…"}
                </option>
                {data.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {memberLabel(m)}
                    {m.user_id === currentUserId ? " (you)" : ""}
                  </option>
                ))}
              </select>
              {!groupId ? (
                <p className="text-xs text-muted-foreground">
                  Choose a group above so member names appear here.
                </p>
              ) : data.members.length === 0 ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  This group has no members loaded. Open the group page, add members,
                  then refresh this receipt.
                </p>
              ) : null}
            </div>
          </div>
        ) : groupId && paidByMemberId ? (
          <p className="text-sm text-muted-foreground">
            Paying back {payer ? memberLabel(payer) : "the payer"}
          </p>
        ) : null}

        {!groupId || data.members.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {canManageSplit
              ? "Link a group with members first. Add friends or invite guests from the group page, then come back."
              : "This receipt isn’t linked to a group yet. Ask the group creator to upload or link it."}
          </p>
        ) : (
          liveSummary &&
          (hasShares || partialUnassigned || owes.length > 0) && (
              <div className="space-y-4 rounded-2xl bg-muted/40 p-4 text-sm">
                {hasShares && (
                  <div>
                    <p className="mb-2 font-medium">Each person&apos;s share</p>
                    {Number(data.receipt.service_charge) > 0 &&
                      data.members.length > 0 && (
                        <p className="mb-3 text-xs text-muted-foreground">
                          Service charge (
                          {formatPHP(Number(data.receipt.service_charge), currency)})
                          split equally among {data.members.length} members
                        </p>
                      )}
                    <ul className="space-y-2">
                      {membersWithShare.map((m) => {
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
                )}

                {paidByMemberId &&
                  (owes.length > 0 ||
                    (!canManageSplit && payerMethods.length > 0)) && (
                    <div
                      className={cn(
                        "space-y-3",
                        hasShares && "border-t border-border pt-3"
                      )}
                    >
                      <p className="font-medium">
                        Pay back {payer ? memberLabel(payer) : "payer"}
                      </p>

                      {!canManageSplit && payerMethods.length > 0 && (
                          <div className="space-y-2 rounded-xl bg-background/60 p-3">
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
                                    onClick={() =>
                                      void copyDetails(paymentMethodCopyText(m))
                                    }
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
                            const from = data.members.find(
                              (x) => x.id === o.fromMemberId
                            );
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

                {partialUnassigned && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Still unclaimed: {formatPHP(liveSummary.unassignedTotal, currency)}
                  </p>
                )}
              </div>
          )
        )}
      </CardContent>
    </Card>
  );
}
