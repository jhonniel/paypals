"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  HandCoins,
  Loader2,
  Mail,
  Plus,
  Search,
  Trash2,
  Upload,
  UserPlus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ConfirmModal } from "@/components/confirm-modal";
import { cn } from "@/lib/utils";
import { readApiJson } from "@/lib/api-client";
import { prepareImageFileForUpload } from "@/lib/convert-heic-client";
import { palDebtRemaining, palDebtorNetBalance } from "@/lib/pal-debt-balance";
import {
  normalizePaymentMethods,
  paymentMethodDisplayLabel,
  toSharedPaymentMethods,
  type PaymentMethod,
} from "@/lib/payment-methods";

type DebtorProfile = {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  email: string | null;
};

type PalDebt = {
  id: string;
  creditor_id: string;
  debtor_id: string;
  amount: number;
  amount_received?: number | null;
  currency: string;
  description: string | null;
  status: "open" | "paid" | "cancelled";
  created_at: string;
  updated_at: string;
  settled_at: string | null;
  debtor: DebtorProfile | DebtorProfile[] | null;
  creditor?: (DebtorProfile & { payment_methods?: unknown }) | (DebtorProfile & { payment_methods?: unknown })[] | null;
};

type PalPerspective = "creditor" | "debtor";

type PalDebtPayment = {
  id: string;
  creditor_id: string;
  debtor_id: string;
  amount: number;
  currency: string;
  note: string | null;
  created_at: string;
  transaction_number?: string | null;
  ocr_amount?: number | null;
};

type PalDebtorCredit = {
  creditor_id: string;
  debtor_id: string;
  credit_balance: number;
  currency: string;
};

type FriendRow = {
  id: string;
  status: string;
  requester_id: string;
  addressee_id: string;
  requester: DebtorProfile | null;
  addressee: DebtorProfile | null;
};

type PersonHit = {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url?: string | null;
  email?: string | null;
  is_guest?: boolean;
  guest_name?: string | null;
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function displayName(p: DebtorProfile | null | undefined) {
  if (!p) return "Unknown";
  return p.full_name?.trim() || p.username || p.email || "Unknown";
}

function money(value: number, currency = "PHP") {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatWhen(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function normalizeDebtor(debt: PalDebt): DebtorProfile | null {
  const d = debt.debtor;
  if (!d) return null;
  return Array.isArray(d) ? d[0] ?? null : d;
}

function normalizeCreditor(debt: PalDebt): DebtorProfile | null {
  const c = debt.creditor;
  if (!c) return null;
  const row = Array.isArray(c) ? c[0] ?? null : c;
  if (!row) return null;
  const { payment_methods: _pm, ...profile } = row;
  return profile;
}

function counterpartyId(debt: PalDebt, perspective: PalPerspective): string {
  return perspective === "creditor" ? debt.debtor_id : debt.creditor_id;
}

function counterpartyFromDebt(debt: PalDebt, perspective: PalPerspective): DebtorProfile | null {
  return perspective === "creditor" ? normalizeDebtor(debt) : normalizeCreditor(debt);
}

type HistoryEntry = {
  id: string;
  debtId: string | null;
  kind: "lent" | "received";
  amount: number;
  currency: string;
  description: string | null;
  at: string;
  debtStatus?: PalDebt["status"];
};

function buildPalHistory(
  debts: PalDebt[],
  payments: PalDebtPayment[],
  counterpartyIdValue: string,
  perspective: PalPerspective
): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const debt of debts.filter((d) => counterpartyId(d, perspective) === counterpartyIdValue)) {
    entries.push({
      id: `${debt.id}-lent`,
      debtId: debt.id,
      kind: "lent",
      amount: Number(debt.amount),
      currency: debt.currency,
      description: debt.description,
      at: debt.created_at,
      debtStatus: debt.status,
    });
  }
  for (const payment of payments.filter((p) =>
    perspective === "creditor"
      ? p.debtor_id === counterpartyIdValue
      : p.creditor_id === counterpartyIdValue
  )) {
    entries.push({
      id: payment.id,
      debtId: null,
      kind: "received",
      amount: Number(payment.amount),
      currency: payment.currency,
      description: payment.note,
      at: payment.created_at,
    });
  }
  return entries.sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()
  );
}

function openDebtTotal(debts: PalDebt[], debtorId?: string): number {
  return debts
    .filter(
      (d) =>
        d.status === "open" && (debtorId == null || d.debtor_id === debtorId)
    )
    .reduce((sum, d) => sum + palDebtRemaining(d), 0);
}

function PalPaymentProofForm({
  idPrefix,
  isCreditor,
  counterpartyId,
  counterpartyName,
  currency,
  rawOpen,
  netBalance,
  compact,
  onSaved,
}: {
  idPrefix: string;
  isCreditor: boolean;
  counterpartyId: string;
  counterpartyName: string;
  currency: string;
  rawOpen: number;
  netBalance: number;
  compact?: boolean;
  onSaved: () => void | Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [txn, setTxn] = useState("");
  const [proofName, setProofName] = useState<string | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const ocrOnly = !isCreditor;
  const firstName = counterpartyName.split(" ")[0] ?? counterpartyName;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (ocrOnly) {
      if (!proofFile) {
        toast.error("Upload a payment receipt screenshot");
        return;
      }
    } else {
      const parsedAmount = amount.trim() ? Number(amount) : null;
      if (!proofFile && (!parsedAmount || parsedAmount <= 0)) {
        toast.error("Enter an amount or upload a payment receipt");
        return;
      }
      if (parsedAmount != null && parsedAmount <= 0) {
        toast.error("Enter a valid amount");
        return;
      }
    }
    setSubmitting(true);
    try {
      let res: Response;
      const parsedAmount = amount.trim() ? Number(amount) : null;
      if (proofFile || ocrOnly) {
        const ready = await prepareImageFileForUpload(proofFile!);
        const form = new FormData();
        form.append(isCreditor ? "debtor_id" : "creditor_id", counterpartyId);
        form.append("file", ready);
        form.append("currency", currency);
        if (!ocrOnly && parsedAmount != null) form.append("amount", String(parsedAmount));
        if (note.trim()) form.append("note", note.trim());
        if (!ocrOnly && txn.trim()) form.append("transaction_number", txn.trim());
        res = await fetch("/api/pal-debts/received/proof", { method: "POST", body: form });
      } else {
        res = await fetch("/api/pal-debts/received", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            isCreditor
              ? {
                  debtor_id: counterpartyId,
                  amount: parsedAmount,
                  currency,
                  note: note.trim() || null,
                }
              : {
                  creditor_id: counterpartyId,
                  amount: parsedAmount,
                  currency,
                  note: note.trim() || null,
                }
          ),
        });
      }
      const parsed = await readApiJson<{
        data: {
          amount_applied?: number;
          transaction_number?: string | null;
        };
      }>(res);
      if (!parsed.ok) throw new Error(parsed.message);
      const applied = parsed.data.data.amount_applied ?? parsedAmount ?? 0;
      const overpay =
        applied > rawOpen && rawOpen >= 0
          ? applied - rawOpen
          : applied > 0 && rawOpen <= 0
            ? applied
            : 0;
      const ref = parsed.data.data.transaction_number;
      toast.success(
        overpay > 0
          ? ocrOnly
            ? `Payment recorded${ref ? ` · ref ${ref}` : ""} · ${money(overpay, currency)} extra saved as credit`
            : `Payment recorded${ref ? ` · ref ${ref}` : ""} · ${money(overpay, currency)} credit for future lent`
          : ref
            ? `Payment recorded · ref ${ref} · ${money(applied, currency)}`
            : isCreditor
              ? "Payment received recorded"
              : `Payment saved · ${money(applied, currency)}`
      );
      if (!ocrOnly) {
        setAmount("");
        setTxn("");
      }
      setNote("");
      setProofFile(null);
      setProofName(null);
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className={cn(
        "space-y-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5",
        compact ? "p-2.5" : "p-3"
      )}
    >
      <p className="text-xs text-muted-foreground">
        {isCreditor
          ? `Record payment from ${firstName}`
          : `Upload proof after paying ${firstName}`}
        {rawOpen > 0
          ? ` · open ${money(rawOpen, currency)}`
          : netBalance < 0
            ? ` · credit ${money(netBalance, currency)}`
            : ""}
        {". "}
        {ocrOnly
          ? "Amount paid and transaction ref are read from your screenshot only. Overpayments become credit on your balance."
          : compact
            ? "Scan receipt to auto-fill amount and ref."
            : "Receipt is scanned only — the image is not saved. Amount and ref are extracted automatically."}
      </p>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-proof`}>Payment receipt</Label>
        <label
          htmlFor={`${idPrefix}-proof`}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-emerald-500/40 bg-background/80 px-3 py-3 text-center transition hover:bg-emerald-500/5",
            submitting && "pointer-events-none opacity-60"
          )}
        >
          <Upload className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <span className="text-xs font-medium">{proofName ?? "Scan receipt screenshot"}</span>
          <span className="text-[10px] text-muted-foreground">
            PNG, JPG, WEBP, or HEIC · max 10MB
          </span>
          <input
            id={`${idPrefix}-proof`}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif"
            className="sr-only"
            disabled={submitting}
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              setProofFile(file);
              setProofName(file?.name ?? null);
              e.target.value = "";
            }}
          />
        </label>
        {proofFile ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            disabled={submitting}
            onClick={() => {
              setProofFile(null);
              setProofName(null);
            }}
          >
            Remove receipt
          </Button>
        ) : null}
      </div>
      {!ocrOnly ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-amount`}>
              {isCreditor ? "Amount received" : "Amount paid"} ({currency})
              {proofFile ? (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  — optional if receipt uploaded
                </span>
              ) : null}
            </Label>
            <Input
              id={`${idPrefix}-amount`}
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "" || /^\d*\.?\d*$/.test(raw)) setAmount(raw);
              }}
              placeholder="0.00"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-txn`}>Transaction number (optional)</Label>
            <Input
              id={`${idPrefix}-txn`}
              type="text"
              value={txn}
              onChange={(e) => setTxn(e.target.value)}
              placeholder="Auto-read from receipt or enter manually"
            />
          </div>
        </>
      ) : null}
      {!compact ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-note`}>Note (optional)</Label>
          <Textarea
            id={`${idPrefix}-note`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="GCash transfer, cash, etc."
          />
        </div>
      ) : (
        <Input
          id={`${idPrefix}-note`}
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          className="text-sm"
        />
      )}
      <Button
        type="submit"
        className="w-full bg-emerald-600 hover:bg-emerald-600/90"
        size={compact ? "sm" : "default"}
        disabled={submitting || (ocrOnly && !proofFile)}
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <Check className="h-4 w-4" />
            {ocrOnly
              ? "Scan & save payment"
              : proofFile
                ? isCreditor
                  ? "Scan & save received"
                  : "Scan & save payment"
                : isCreditor
                  ? "Save received"
                  : "Save payment"}
          </>
        )}
      </Button>
    </form>
  );
}

export function PalOwesMePageView({
  currentUserId,
  initialPerspective = "creditor",
}: {
  currentUserId: string;
  initialPerspective?: PalPerspective;
}) {
  const qc = useQueryClient();
  const [perspective, setPerspective] = useState<PalPerspective>(initialPerspective);
  const [filter, setFilter] = useState<"open" | "paid" | "all">("open");
  const [addOpen, setAddOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<PalDebt | null>(null);
  const [deletePaymentConfirm, setDeletePaymentConfirm] =
    useState<PalDebtPayment | null>(null);
  const [selectedCounterpartyId, setSelectedCounterpartyId] = useState<string | null>(null);
  const [selectedCounterpartyProfile, setSelectedCounterpartyProfile] =
    useState<DebtorProfile | null>(null);
  const [pickPalOpen, setPickPalOpen] = useState(false);

  const querySuffix = useMemo(() => {
    const params = new URLSearchParams();
    params.set("perspective", perspective);
    if (filter !== "all") params.set("status", filter);
    return `?${params.toString()}`;
  }, [perspective, filter]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["pal-debts", perspective, filter],
    queryFn: async () => {
      const res = await fetch(`/api/pal-debts${querySuffix}`);
      const parsed = await readApiJson<{
        data: {
          perspective: PalPerspective;
          debts: PalDebt[];
          summary: {
            open_count: number;
            open_total: number;
            currency: string;
          };
        };
      }>(res);
      if (!parsed.ok) throw new Error(parsed.message);
      return parsed.data.data;
    },
    staleTime: 60_000,
  });

  const { data: allData, isLoading: allLoading } = useQuery({
    queryKey: ["pal-debts", perspective, "all"],
    queryFn: async () => {
      const res = await fetch(`/api/pal-debts?perspective=${perspective}`);
      const parsed = await readApiJson<{
        data: {
          perspective: PalPerspective;
          debts: PalDebt[];
          payments?: PalDebtPayment[];
          credits?: PalDebtorCredit[];
        };
      }>(res);
      if (!parsed.ok) throw new Error(parsed.message);
      return {
        debts: parsed.data.data.debts,
        payments: parsed.data.data.payments ?? [],
        credits: parsed.data.data.credits ?? [],
      };
    },
    staleTime: 60_000,
  });

  const debts = data?.debts ?? [];
  const summary = data?.summary;
  const allDebts = allData?.debts ?? [];
  const allPayments = allData?.payments ?? [];
  const allCredits = allData?.credits ?? [];

  const creditByCounterparty = useMemo(() => {
    const map = new Map<string, number>();
    const key = perspective === "creditor" ? "debtor_id" : "creditor_id";
    for (const c of allCredits) {
      map.set(c[key], Number(c.credit_balance ?? 0));
    }
    return map;
  }, [allCredits, perspective]);

  const grouped = useMemo(() => {
    const map = new Map<
      string,
      {
        counterparty: DebtorProfile | null;
        debts: PalDebt[];
        openTotal: number;
        creditBalance: number;
        netBalance: number;
        currency: string;
      }
    >();
    for (const debt of allDebts) {
      const cp = counterpartyFromDebt(debt, perspective);
      const key = counterpartyId(debt, perspective);
      const row = map.get(key) ?? {
        counterparty: cp,
        debts: [],
        openTotal: 0,
        creditBalance: creditByCounterparty.get(key) ?? 0,
        netBalance: 0,
        currency: debt.currency,
      };
      if (cp && !row.counterparty) row.counterparty = cp;
      if (!row.debts.some((d) => d.id === debt.id)) {
        row.debts.push(debt);
      }
      if (debt.status === "open") {
        row.openTotal += palDebtRemaining(debt);
      }
      map.set(key, row);
    }
    for (const credit of allCredits) {
      const key =
        perspective === "creditor" ? credit.debtor_id : credit.creditor_id;
      const row = map.get(key) ?? {
        counterparty: null,
        debts: [],
        openTotal: 0,
        creditBalance: 0,
        netBalance: 0,
        currency: credit.currency,
      };
      row.creditBalance = Number(credit.credit_balance ?? 0);
      map.set(key, row);
    }
    for (const row of map.values()) {
      row.debts.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      row.netBalance = palDebtorNetBalance(row.openTotal, row.creditBalance);
    }
    return [...map.values()].sort((a, b) => b.netBalance - a.netBalance);
  }, [allDebts, allCredits, creditByCounterparty, perspective]);

  const visibleGroups = useMemo(() => {
    if (filter === "open") {
      return grouped.filter((g) => g.netBalance > 0);
    }
    if (filter === "paid") {
      return grouped.filter(
        (g) =>
          g.netBalance <= 0 &&
          (g.debts.length > 0 ||
            g.creditBalance > 0 ||
            allPayments.some(
              (p) =>
                (perspective === "creditor"
                  ? p.debtor_id
                  : p.creditor_id) ===
                (g.counterparty?.id ?? counterpartyId(g.debts[0]!, perspective))
            ))
      );
    }
    return grouped;
  }, [grouped, filter, allPayments, perspective]);

  const listLoading = isLoading || allLoading;

  const selectedGroup = useMemo(() => {
    if (!selectedCounterpartyId) return null;
    const personDebts = allDebts.filter(
      (d) => counterpartyId(d, perspective) === selectedCounterpartyId
    );
    const counterparty =
      selectedCounterpartyProfile ??
      (personDebts[0] ? counterpartyFromDebt(personDebts[0], perspective) : null);
    if (!counterparty && personDebts.length === 0) {
      const paymentHit = allPayments.find((p) =>
        perspective === "creditor"
          ? p.debtor_id === selectedCounterpartyId
          : p.creditor_id === selectedCounterpartyId
      );
      if (!paymentHit) return null;
    }
    const resolvedCounterparty = counterparty ?? selectedCounterpartyProfile;
    if (!resolvedCounterparty) return null;
    const openTotal = openDebtTotal(personDebts);
    const creditBalance = creditByCounterparty.get(selectedCounterpartyId) ?? 0;
    const creditorPaymentMethods =
      perspective === "debtor" && personDebts[0]?.creditor
        ? normalizePaymentMethods(
            (Array.isArray(personDebts[0].creditor)
              ? personDebts[0].creditor[0]
              : personDebts[0].creditor
            )?.payment_methods
          )
        : [];
    return {
      counterparty: resolvedCounterparty,
      debts: [...personDebts].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ),
      payments: allPayments.filter((p) =>
        perspective === "creditor"
          ? p.debtor_id === selectedCounterpartyId
          : p.creditor_id === selectedCounterpartyId
      ),
      openTotal,
      creditBalance,
      netBalance: palDebtorNetBalance(openTotal, creditBalance),
      currency:
        personDebts[0]?.currency ??
        allCredits.find((c) =>
          perspective === "creditor"
            ? c.debtor_id === selectedCounterpartyId
            : c.creditor_id === selectedCounterpartyId
        )?.currency ??
        "PHP",
      creditorPaymentMethods,
    };
  }, [
    selectedCounterpartyId,
    selectedCounterpartyProfile,
    allDebts,
    allPayments,
    allCredits,
    creditByCounterparty,
    perspective,
  ]);

  function openPal(person: DebtorProfile) {
    setSelectedCounterpartyId(person.id);
    setSelectedCounterpartyProfile(person);
  }

  function closePalModal() {
    setSelectedCounterpartyId(null);
    setSelectedCounterpartyProfile(null);
  }

  async function deleteDebt(debt: PalDebt) {
    setBusyId(debt.id);
    try {
      const res = await fetch(`/api/pal-debts/${debt.id}`, { method: "DELETE" });
      const parsed = await readApiJson(res);
      if (!parsed.ok) throw new Error(parsed.message);
      toast.success("Lent record removed");
      setDeleteConfirm(null);
      await qc.invalidateQueries({ queryKey: ["pal-debts"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusyId(null);
    }
  }

  async function deletePayment(payment: PalDebtPayment) {
    setBusyId(payment.id);
    try {
      const res = await fetch(`/api/pal-debts/payments/${payment.id}`, {
        method: "DELETE",
      });
      const parsed = await readApiJson(res);
      if (!parsed.ok) throw new Error(parsed.message);
      toast.success("Received payment removed — balance restored");
      setDeletePaymentConfirm(null);
      await qc.invalidateQueries({ queryKey: ["pal-debts"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {perspective === "creditor" ? "Pal owes me" : "I owe pals"}
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            {perspective === "creditor"
              ? "Track what friends owe you outside of group receipts — lunch, rides, loans, and more."
              : "See debts others recorded for you. Pay them using their payout details below each person."}
          </p>
        </div>
        {perspective === "creditor" ? (
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Record debt
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {(["creditor", "debtor"] as const).map((tab) => (
          <Button
            key={tab}
            type="button"
            size="sm"
            variant={perspective === tab ? "default" : "outline"}
            onClick={() => {
              setPerspective(tab);
              closePalModal();
            }}
          >
            {tab === "creditor" ? "Owes me" : "I owe"}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <HandCoins className="h-4 w-4 text-primary" />
            {perspective === "creditor" ? "Total open" : "Total you owe"}
          </CardTitle>
          <CardDescription>
            {perspective === "creditor"
              ? "Unpaid amounts you're tracking"
              : "Open balances from pals who lent you money"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-10 w-40" />
          ) : (
            <p className="text-3xl font-semibold tabular-nums tracking-tight">
              {money(summary?.open_total ?? 0, summary?.currency ?? "PHP")}
            </p>
          )}
          {!isLoading && (summary?.open_count ?? 0) > 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {summary!.open_count} open record{summary!.open_count === 1 ? "" : "s"}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {(["open", "paid", "all"] as const).map((tab) => (
          <Button
            key={tab}
            type="button"
            size="sm"
            variant={filter === tab ? "default" : "outline"}
            onClick={() => setFilter(tab)}
          >
            {tab === "open" ? "Open" : tab === "paid" ? "Paid" : "All"}
          </Button>
        ))}
      </div>

      {listLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Could not load records"}
        </p>
      ) : visibleGroups.length === 0 ? (
        <div className="space-y-4">
          {perspective === "creditor" ? (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
              <li>
                <button
                  type="button"
                  onClick={() => setPickPalOpen(true)}
                  className="glass flex h-full min-h-[6.25rem] w-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-primary/30 p-2 text-center transition hover:bg-primary/5 active:scale-[0.98]"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <UserPlus className="h-4 w-4" />
                  </div>
                  <p className="text-xs font-medium text-primary">Add pal</p>
                </button>
              </li>
            </ul>
          ) : null}
          <Card>
            <CardContent className="flex flex-col items-center gap-3 px-4 py-8 text-center">
              <HandCoins className="h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                {filter === "open"
                  ? perspective === "creditor"
                    ? "Add a pal to track who owes you, then record amounts from their profile."
                    : "When someone records that you owe them, it will show up here automatically."
                  : "Nothing here for this filter."}
              </p>
              {filter === "open" && perspective === "creditor" && (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="outline" onClick={() => setPickPalOpen(true)}>
                    <UserPlus className="h-4 w-4" />
                    Add pal
                  </Button>
                  <Button variant="outline" onClick={() => setAddOpen(true)}>
                    <Plus className="h-4 w-4" />
                    Record debt
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {perspective === "creditor" ? (
            <li>
              <button
                type="button"
                onClick={() => setPickPalOpen(true)}
                className="glass flex h-full min-h-[6.25rem] w-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-primary/30 p-2 text-center transition hover:bg-primary/5 active:scale-[0.98]"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <UserPlus className="h-4 w-4" />
                </div>
                <p className="text-xs font-medium text-primary">Add pal</p>
              </button>
            </li>
          ) : null}
          {visibleGroups.map((group) => {
            const name = displayName(group.counterparty);
            const net = group.netBalance;
            const cpId =
              group.counterparty?.id ??
              (group.debts[0] ? counterpartyId(group.debts[0], perspective) : undefined);
            return (
              <li key={cpId}>
                <button
                  type="button"
                  onClick={() => {
                    if (group.counterparty) openPal(group.counterparty);
                    else if (cpId) {
                      setSelectedCounterpartyId(cpId);
                      setSelectedCounterpartyProfile(null);
                    }
                  }}
                    className={cn(
                      "glass flex h-full min-h-[6.25rem] w-full flex-col gap-1.5 rounded-2xl p-2 text-left transition hover:bg-muted/40 active:scale-[0.98]"
                    )}
                  >
                    <div className="flex flex-col items-center gap-1.5 text-center">
                      <Avatar className="h-8 w-8 shrink-0">
                        {group.counterparty?.avatar_url ? (
                          <AvatarImage src={group.counterparty.avatar_url} alt="" />
                        ) : null}
                        <AvatarFallback className="text-[11px]">
                          {initials(name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 w-full">
                        <p className="truncate text-xs font-medium leading-tight">
                          {name}
                        </p>
                        {group.counterparty?.username ? (
                          <p className="truncate text-[9px] text-muted-foreground">
                            @{group.counterparty.username}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    {net > 0 ? (
                      <div className="mt-auto flex flex-col items-center justify-center rounded-lg bg-background/60 px-1.5 py-1.5 text-center">
                        <p className="text-[8px] font-medium uppercase tracking-wide text-muted-foreground">
                          {perspective === "creditor" ? "Owes you" : "You owe"}
                        </p>
                        <p className="w-full text-base font-bold tabular-nums leading-none tracking-tight text-amber-600 dark:text-amber-400 sm:text-lg">
                          {money(net, group.currency)}
                        </p>
                      </div>
                    ) : net < 0 ? (
                      <div className="mt-auto flex flex-col items-center justify-center rounded-lg bg-background/60 px-1.5 py-1.5 text-center">
                        <p className="text-[8px] font-medium uppercase tracking-wide text-muted-foreground">
                          Credit
                        </p>
                        <p className="w-full text-base font-bold tabular-nums leading-none tracking-tight text-emerald-600 dark:text-emerald-400 sm:text-lg">
                          {money(net, group.currency)}
                        </p>
                      </div>
                    ) : (
                      <p className="mt-auto text-center text-[9px] text-muted-foreground">
                        {filter === "paid" ? "Settled" : "No open balance"}
                      </p>
                    )}
                  </button>
                </li>
            );
          })}
        </ul>
      )}

      {selectedGroup && selectedCounterpartyId && (
        <DebtorDetailModal
          group={selectedGroup}
          counterpartyId={selectedCounterpartyId}
          perspective={perspective}
          currentUserId={currentUserId}
          busyId={busyId}
          onClose={closePalModal}
          onDelete={(debt) => setDeleteConfirm(debt)}
          onDeletePayment={(payment) => setDeletePaymentConfirm(payment)}
          onRecordSaved={async () => {
            setFilter("open");
            await qc.invalidateQueries({ queryKey: ["pal-debts"] });
          }}
        />
      )}

      {perspective === "creditor" && pickPalOpen && (
        <AddDebtModal
          currentUserId={currentUserId}
          pickOnly
          onClose={() => setPickPalOpen(false)}
          onPalPicked={(person) => {
            setPickPalOpen(false);
            openPal(person as DebtorProfile);
          }}
          onSaved={async () => {
            setPickPalOpen(false);
            setFilter("open");
            await qc.invalidateQueries({ queryKey: ["pal-debts"] });
          }}
        />
      )}

      {perspective === "creditor" && addOpen && (
        <AddDebtModal
          currentUserId={currentUserId}
          onClose={() => setAddOpen(false)}
          onSaved={async () => {
            setAddOpen(false);
            setFilter("open");
            await qc.invalidateQueries({ queryKey: ["pal-debts"] });
          }}
        />
      )}

      {deleteConfirm && (
        <ConfirmModal
          title="Remove lent record?"
          description="This deletes the lent entry. Any received payments will be reapplied to remaining records."
          highlight={
            <p className="text-sm font-medium">
              {money(Number(deleteConfirm.amount), deleteConfirm.currency)}
              {deleteConfirm.description ? ` · ${deleteConfirm.description}` : ""}
            </p>
          }
          highlightClassName="border-destructive/30 bg-destructive/5"
          confirmLabel="Remove"
          variant="destructive"
          busy={busyId === deleteConfirm.id}
          onConfirm={() => void deleteDebt(deleteConfirm)}
          onClose={() => {
            if (busyId) return;
            setDeleteConfirm(null);
          }}
        />
      )}

      {deletePaymentConfirm && (
        <ConfirmModal
          title="Remove received payment?"
          description="This restores the amount to what they owe you (lent balance goes back up)."
          highlight={
            <p className="text-sm font-medium">
              {money(Number(deletePaymentConfirm.amount), deletePaymentConfirm.currency)}
              {deletePaymentConfirm.note ? ` · ${deletePaymentConfirm.note}` : ""}
            </p>
          }
          highlightClassName="border-destructive/30 bg-destructive/5"
          confirmLabel="Remove"
          variant="destructive"
          busy={busyId === deletePaymentConfirm.id}
          onConfirm={() => void deletePayment(deletePaymentConfirm)}
          onClose={() => {
            if (busyId) return;
            setDeletePaymentConfirm(null);
          }}
        />
      )}
    </div>
  );
}

function PalOwedCollapsible({
  debtor,
  openAmount,
  currency,
  methods,
  perspective = "creditor",
  counterpartyId,
  rawOpen = 0,
  netBalance = 0,
  onPaymentSaved,
}: {
  debtor: DebtorProfile | null;
  openAmount: number;
  currency: string;
  methods: PaymentMethod[];
  perspective?: PalPerspective;
  counterpartyId?: string;
  rawOpen?: number;
  netBalance?: number;
  onPaymentSaved?: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const name = displayName(debtor);
  const owesLabel =
    perspective === "creditor"
      ? openAmount > 0
        ? "Owes you"
        : openAmount < 0
          ? "Credit"
          : "No open balance"
      : openAmount > 0
        ? "You owe"
        : openAmount < 0
          ? "Credit"
          : "No open balance";

  return (
    <div className="rounded-xl border border-border bg-muted/15">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar className="h-9 w-9 shrink-0">
          {debtor?.avatar_url ? <AvatarImage src={debtor.avatar_url} alt="" /> : null}
          <AvatarFallback className="text-xs">{initials(name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{name}</p>
          <p className="text-xs text-muted-foreground">
            {openAmount > 0 ? (
              <>
                {perspective === "creditor" ? "Owes you" : "You owe"}{" "}
                <span className="font-medium tabular-nums text-amber-700 dark:text-amber-300">
                  {money(openAmount, currency)}
                </span>
              </>
            ) : openAmount < 0 ? (
              <>
                Credit{" "}
                <span className="font-medium tabular-nums text-emerald-700 dark:text-emerald-300">
                  {money(openAmount, currency)}
                </span>
              </>
            ) : (
              owesLabel
            )}
          </p>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 ease-out",
            open && "rotate-180"
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="pal-owed-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="space-y-3 border-t border-border px-3 pb-3 pt-2">
          {debtor?.username ? (
            <p className="text-xs text-muted-foreground">@{debtor.username}</p>
          ) : null}
          {debtor?.email ? (
            <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
              <Mail className="h-3 w-3 shrink-0" />
              {debtor.email}
            </p>
          ) : null}

          {methods.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {perspective === "creditor" ? (
                <>
                  Add payout accounts in{" "}
                  <Link href="/settings" className="underline">
                    Settings
                  </Link>{" "}
                  so {name.split(" ")[0] ?? name} knows where to pay.
                </>
              ) : (
                <>{name.split(" ")[0] ?? name} has not added payout accounts yet.</>
              )}
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {perspective === "creditor" ? "Your payout details" : "Pay them here"}
              </p>
              {methods.map((method) => (
                <div
                  key={method.id}
                  className="space-y-2 rounded-lg border border-primary/15 bg-primary/5 px-2.5 py-2"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium">{paymentMethodDisplayLabel(method)}</span>
                    {method.account_number ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 px-2 text-[11px]"
                        onClick={() => {
                          void navigator.clipboard.writeText(method.account_number).then(
                            () => toast.success("Copied"),
                            () => toast.error("Could not copy")
                          );
                        }}
                      >
                        <Copy className="h-3 w-3" />
                        Copy
                      </Button>
                    ) : null}
                  </div>
                  {method.account_number ? (
                    <p className="break-all font-mono text-sm font-semibold tabular-nums">
                      {method.account_number}
                    </p>
                  ) : null}
                  {method.qr_code_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={method.qr_code_url}
                      alt={`${paymentMethodDisplayLabel(method)} QR`}
                      className="mx-auto h-28 w-28 rounded-lg border border-border bg-white object-contain p-1.5"
                    />
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {perspective === "debtor" && counterpartyId && onPaymentSaved ? (
            <PalPaymentProofForm
              idPrefix={`pay-here-${counterpartyId}`}
              isCreditor={false}
              counterpartyId={counterpartyId}
              counterpartyName={name}
              currency={currency}
              rawOpen={rawOpen}
              netBalance={netBalance}
              compact
              onSaved={onPaymentSaved}
            />
          ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function PalAnimatedModal({
  onClose,
  ariaLabelledBy,
  blockClose = false,
  children,
}: {
  onClose: () => void;
  ariaLabelledBy: string;
  blockClose?: boolean;
  children: (requestClose: () => void) => React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(true);

  const requestClose = useCallback(() => {
    if (blockClose) return;
    setVisible(false);
  }, [blockClose]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
      window.removeEventListener("keydown", onKey);
    };
  }, [requestClose]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence onExitComplete={onClose}>
      {visible ? (
        <>
          <motion.button
            key="pal-modal-backdrop"
            type="button"
            aria-label="Close dialog"
            disabled={blockClose}
            className="fixed inset-0 z-[100] bg-black/65 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            onClick={requestClose}
          />
          <motion.div
            key="pal-modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={ariaLabelledBy}
            className="fixed inset-x-0 bottom-0 z-[101] flex max-h-[92dvh] justify-center sm:inset-0 sm:items-center sm:p-4"
            initial={{ opacity: 0, y: 56, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.98 }}
            transition={{ type: "spring", damping: 32, stiffness: 380, mass: 0.85 }}
            style={{ paddingBottom: "max(0px, env(safe-area-inset-bottom))" }}
          >
            <div
              className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-border bg-background shadow-2xl sm:rounded-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {children(requestClose)}
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}

function DebtorDetailModal({
  group,
  counterpartyId,
  perspective,
  currentUserId: _currentUserId,
  busyId,
  onClose,
  onDelete,
  onDeletePayment,
  onRecordSaved,
}: {
  group: {
    counterparty: DebtorProfile | null;
    debts: PalDebt[];
    payments: PalDebtPayment[];
    openTotal: number;
    creditBalance: number;
    netBalance: number;
    currency: string;
    creditorPaymentMethods?: ReturnType<typeof normalizePaymentMethods>;
  };
  counterpartyId: string;
  perspective: PalPerspective;
  currentUserId: string;
  busyId: string | null;
  onClose: () => void;
  onDelete: (debt: PalDebt) => void;
  onDeletePayment: (payment: PalDebtPayment) => void;
  onRecordSaved: () => void | Promise<void>;
}) {
  const isCreditor = perspective === "creditor";
  const [recordOpen, setRecordOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [recording, setRecording] = useState(false);
  const name = displayName(group.counterparty);

  const { data: profileData } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const res = await fetch("/api/profile");
      const parsed = await readApiJson<{
        data: { profile?: { payment_methods?: unknown } };
      }>(res);
      if (!parsed.ok) throw new Error(parsed.message);
      return parsed.data.data;
    },
    enabled: isCreditor,
  });

  const payoutMethods = useMemo(() => {
    if (!isCreditor) {
      return toSharedPaymentMethods(group.creditorPaymentMethods ?? []);
    }
    return toSharedPaymentMethods(
      normalizePaymentMethods(profileData?.profile?.payment_methods)
    );
  }, [isCreditor, group.creditorPaymentMethods, profileData]);

  const history = useMemo(
    () => buildPalHistory(group.debts, group.payments, counterpartyId, perspective),
    [group.debts, group.payments, counterpartyId, perspective]
  );

  const totals = useMemo(() => {
    let lent = 0;
    let received = 0;
    for (const debt of group.debts) {
      lent += Number(debt.amount);
    }
    for (const payment of group.payments) {
      received += Number(payment.amount);
    }
    return {
      lent,
      received,
      open: group.netBalance,
      rawOpen: group.openTotal,
      credit: group.creditBalance,
    };
  }, [group.debts, group.payments, group.netBalance, group.openTotal, group.creditBalance]);

  const openDebtsById = useMemo(
    () =>
      new Map(
        group.debts
          .filter((d) => d.status === "open" && palDebtRemaining(d) > 0)
          .map((d) => [d.id, d])
      ),
    [group.debts]
  );

  useEffect(() => {
    setRecordOpen(false);
    setReceiveOpen(false);
  }, [counterpartyId]);

  async function submitRecord(e: React.FormEvent) {
    e.preventDefault();
    const parsedAmount = Number(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    setRecording(true);
    try {
      const res = await fetch("/api/pal-debts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          debtor_id: counterpartyId,
          amount: parsedAmount,
          description: description.trim() || null,
        }),
      });
      const parsed = await readApiJson(res);
      if (!parsed.ok) throw new Error(parsed.message);
      toast.success("Debt recorded");
      setAmount("");
      setDescription("");
      setRecordOpen(false);
      await onRecordSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setRecording(false);
    }
  }

  return (
    <PalAnimatedModal
      ariaLabelledBy="debtor-detail-title"
      blockClose={recording}
      onClose={onClose}
    >
      {(requestClose) => (
        <>
        <div className="sticky top-0 z-[1] border-b border-border bg-background px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar className="h-10 w-10 shrink-0">
                {group.counterparty?.avatar_url ? (
                  <AvatarImage src={group.counterparty.avatar_url} alt="" />
                ) : null}
                <AvatarFallback>{initials(name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <h2 id="debtor-detail-title" className="truncate text-base font-semibold">
                  {name}
                </h2>
                {group.counterparty?.username ? (
                  <p className="text-xs text-muted-foreground">@{group.counterparty.username}</p>
                ) : null}
              </div>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-10 w-10 shrink-0"
              aria-label="Close"
              disabled={recording}
              onClick={requestClose}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          {isCreditor ? (
            <div className="mt-3 flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={recordOpen ? "secondary" : "default"}
                className="flex-1"
                disabled={recording}
                onClick={() => {
                  setReceiveOpen(false);
                  setRecordOpen((v) => !v);
                }}
              >
                <ArrowUpRight className="h-3.5 w-3.5" />
                {recordOpen ? "Cancel" : "Lent"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={receiveOpen ? "secondary" : "outline"}
                className="flex-1 border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
                disabled={recording}
                onClick={() => {
                  setRecordOpen(false);
                  setReceiveOpen((v) => !v);
                }}
              >
                <ArrowDownLeft className="h-3.5 w-3.5" />
                {receiveOpen ? "Cancel" : "Received"}
              </Button>
            </div>
          ) : (
            <div className="mt-3 flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={recordOpen ? "secondary" : "outline"}
                className="flex-1"
                disabled={recording}
                onClick={() => {
                  setReceiveOpen(false);
                  setRecordOpen((v) => !v);
                }}
              >
                <ArrowUpRight className="h-3.5 w-3.5" />
                {recordOpen ? "Cancel" : "Lent"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={receiveOpen ? "secondary" : "default"}
                className="flex-1 bg-emerald-600 hover:bg-emerald-600/90"
                disabled={recording}
                onClick={() => {
                  setRecordOpen(false);
                  setReceiveOpen((v) => !v);
                }}
              >
                <ArrowDownLeft className="h-3.5 w-3.5" />
                {receiveOpen ? "Cancel" : "Paid"}
              </Button>
            </div>
          )}

          {!isCreditor && recordOpen ? (
            <div className="mt-3 space-y-2 rounded-xl border border-primary/25 bg-primary/5 p-3">
              <p className="text-xs text-muted-foreground">
                Amounts {name.split(" ")[0] ?? name} lent you. They record new lent entries on
                their <span className="font-medium">Owes me</span> tab.
              </p>
              {group.debts.filter((d) => d.status === "open" && palDebtRemaining(d) > 0).length >
              0 ? (
                <ul className="space-y-1.5">
                  {group.debts
                    .filter((d) => d.status === "open" && palDebtRemaining(d) > 0)
                    .map((d) => (
                      <li
                        key={d.id}
                        className="flex items-center justify-between rounded-lg border border-border bg-background/80 px-2.5 py-2 text-sm"
                      >
                        <span className="truncate text-muted-foreground">
                          {d.description?.startsWith("From group:") ? (
                            <span className="inline-flex flex-col items-start gap-0.5">
                              <span className="rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-300">
                                From group
                              </span>
                              <span>{d.description.replace(/^From group:\s*/, "")}</span>
                            </span>
                          ) : (
                            d.description || "Lent"
                          )}
                        </span>
                        <span className="shrink-0 font-semibold tabular-nums">
                          {money(palDebtRemaining(d), d.currency)}
                        </span>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">No open lent amounts right now.</p>
              )}
            </div>
          ) : null}

          {receiveOpen ? (
            <div className="mt-3">
              <PalPaymentProofForm
                idPrefix={`modal-${counterpartyId}`}
                isCreditor={isCreditor}
                counterpartyId={counterpartyId}
                counterpartyName={name}
                currency={group.currency}
                rawOpen={totals.rawOpen}
                netBalance={totals.open}
                onSaved={async () => {
                  setReceiveOpen(false);
                  await onRecordSaved();
                }}
              />
            </div>
          ) : null}

          {isCreditor && recordOpen ? (
            <form
              onSubmit={(e) => void submitRecord(e)}
              className="mt-3 space-y-3 rounded-xl border border-primary/25 bg-primary/5 p-3"
            >
              <p className="text-xs text-muted-foreground">
                Add what {name.split(" ")[0] ?? name} owes you
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="pal-record-amount">Amount (PHP)</Label>
                <Input
                  id="pal-record-amount"
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === "" || /^\d*\.?\d*$/.test(raw)) setAmount(raw);
                  }}
                  placeholder="0.00"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pal-record-note">What for? (optional)</Label>
                <Textarea
                  id="pal-record-note"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="Lunch, ride share, borrowed cash…"
                />
              </div>
              <Button type="submit" className="w-full" disabled={recording}>
                {recording ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Save record
                  </>
                )}
              </Button>
            </form>
          ) : null}

          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-2 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {totals.open < 0
                  ? "Credit"
                  : perspective === "creditor"
                    ? "Owes you"
                    : "You owe"}
              </p>
              <p
                className={cn(
                  "text-sm font-semibold tabular-nums",
                  totals.open < 0
                    ? "text-emerald-700 dark:text-emerald-300"
                    : "text-amber-700 dark:text-amber-300"
                )}
              >
                {money(totals.open, group.currency)}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-muted/30 px-2 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {perspective === "creditor" ? "Lent" : "They lent"}
              </p>
              <p className="text-sm font-semibold tabular-nums">
                {money(totals.lent, group.currency)}
              </p>
            </div>
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-2 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {perspective === "creditor" ? "Received" : "You paid"}
              </p>
              <p className="text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
                {money(totals.received, group.currency)}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-4">
          <PalOwedCollapsible
            debtor={group.counterparty}
            openAmount={totals.open}
            currency={group.currency}
            methods={payoutMethods}
            perspective={perspective}
            counterpartyId={counterpartyId}
            rawOpen={totals.rawOpen}
            netBalance={totals.open}
            onPaymentSaved={onRecordSaved}
          />

          <div>
            <h3 className="mb-3 text-sm font-medium text-muted-foreground">History</h3>
          {history.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No history yet.</p>
          ) : (
            <ul className="space-y-2">
              {history.map((entry) => {
                const isLent = entry.kind === "lent";
                const openDebt =
                  entry.debtId != null
                    ? group.debts.find((d) => d.id === entry.debtId)
                    : undefined;
                const payment =
                  !isLent && entry.debtId == null
                    ? group.payments.find((p) => p.id === entry.id)
                    : undefined;
                const busy = busyId === (entry.debtId ?? entry.id);
                const remaining =
                  entry.debtId != null
                    ? palDebtRemaining(
                        group.debts.find((d) => d.id === entry.debtId) ?? {
                          amount: entry.amount,
                          status: "paid",
                        }
                      )
                    : 0;
                return (
                  <li
                    key={entry.id}
                    className={cn(
                      "rounded-xl border border-border p-3",
                      isLent ? "bg-muted/15" : "bg-emerald-500/5"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                          isLent
                            ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                            : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        )}
                      >
                        {isLent ? (
                          <ArrowUpRight className="h-4 w-4" />
                        ) : (
                          <ArrowDownLeft className="h-4 w-4" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold">
                            {isLent
                              ? perspective === "creditor"
                                ? "Lent money"
                                : "They lent you"
                              : perspective === "creditor"
                                ? "Received payment"
                                : "You paid"}
                          </p>
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase",
                              isLent
                                ? entry.debtStatus === "open"
                                  ? "bg-amber-500/15 text-amber-800 dark:text-amber-200"
                                  : "bg-muted text-muted-foreground"
                                : "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
                            )}
                          >
                            {isLent
                              ? entry.debtStatus === "open" &&
                                entry.debtId &&
                                openDebtsById.has(entry.debtId)
                                ? "Unpaid"
                                : "Settled"
                              : "Received"}
                          </span>
                        </div>
                        <p className="mt-0.5 text-lg font-semibold tabular-nums">
                          {money(entry.amount, entry.currency)}
                        </p>
                        {isLent && remaining > 0 && remaining < entry.amount ? (
                          <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                            {money(remaining, entry.currency)} still owed
                          </p>
                        ) : null}
                        {entry.description ? (
                          <p className="mt-0.5 text-sm text-muted-foreground">
                            {entry.description.startsWith("From group:") ? (
                              <>
                                <span className="mr-1.5 inline-flex rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-300">
                                  From group
                                </span>
                                {entry.description.replace(/^From group:\s*/, "")}
                              </>
                            ) : (
                              entry.description
                            )}
                          </p>
                        ) : null}
                        {payment?.transaction_number ? (
                          <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                            Ref: {payment.transaction_number}
                          </p>
                        ) : null}
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatWhen(entry.at)}
                        </p>
                      </div>
                      {isCreditor && isLent && openDebt && entry.debtId ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-8 shrink-0 text-destructive hover:text-destructive"
                          disabled={busy}
                          onClick={() => onDelete(openDebt)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                      {isCreditor && !isLent && payment ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-8 shrink-0 text-destructive hover:text-destructive"
                          disabled={busy}
                          onClick={() => onDeletePayment(payment)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          </div>
        </div>
        </>
      )}
    </PalAnimatedModal>
  );
}

function AddDebtModal({
  currentUserId,
  pickOnly = false,
  onClose,
  onSaved,
  onPalPicked,
}: {
  currentUserId: string;
  pickOnly?: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onPalPicked?: (person: PersonHit) => void;
}) {
  const [mode, setMode] = useState<"friends" | "search">("friends");
  const [query, setQuery] = useState("");
  const [searchHits, setSearchHits] = useState<PersonHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<PersonHit | null>(null);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: friends, isLoading: friendsLoading } = useQuery({
    queryKey: ["friends"],
    queryFn: async () => {
      const res = await fetch("/api/friends");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed");
      return (json.data ?? []) as FriendRow[];
    },
  });

  const acceptedFriends = useMemo(() => {
    return (friends ?? [])
      .filter((f) => f.status === "accepted")
      .map((f) => {
        const other =
          f.requester_id === currentUserId ? f.addressee : f.requester;
        if (!other) return null;
        return {
          id: other.id,
          full_name: other.full_name,
          username: other.username,
          avatar_url: other.avatar_url,
          email: other.email,
        } satisfies PersonHit;
      })
      .filter(Boolean) as PersonHit[];
  }, [friends, currentUserId]);

  useEffect(() => {
    if (mode !== "search" || query.trim().length < 2) {
      setSearchHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      setSearching(true);
      void fetch(`/api/search?q=${encodeURIComponent(query.trim())}`)
        .then((r) => r.json())
        .then((json) => {
          setSearchHits((json?.data?.people ?? []) as PersonHit[]);
        })
        .catch(() => setSearchHits([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => window.clearTimeout(t);
  }, [mode, query]);

  function pickPerson(person: PersonHit) {
    if (pickOnly) {
      onPalPicked?.(person);
      return;
    }
    setSelected(person);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) {
      toast.error("Pick who owes you");
      return;
    }
    const parsedAmount = Number(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/pal-debts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          debtor_id: selected.id,
          amount: parsedAmount,
          description: description.trim() || null,
        }),
      });
      const parsed = await readApiJson(res);
      if (!parsed.ok) throw new Error(parsed.message);
      toast.success("Debt recorded — use Received when they pay you back");
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PalAnimatedModal
      ariaLabelledBy="add-debt-title"
      blockClose={busy}
      onClose={onClose}
    >
      {(requestClose) => (
        <>
        <div className="sticky top-0 z-[1] flex items-start justify-between gap-3 border-b border-border bg-background px-4 py-3">
          <div>
            <h2 id="add-debt-title" className="text-base font-semibold">
              {pickOnly ? "Add pal to track" : "Record debt"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {pickOnly
                ? "Pick someone to track — record amounts from their profile."
                : "Who owes you and how much?"}
            </p>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-10 w-10 shrink-0"
            aria-label="Close"
            disabled={busy}
            onClick={requestClose}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="space-y-4 p-4">
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={mode === "friends" ? "default" : "outline"}
              onClick={() => setMode("friends")}
            >
              Friends
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "search" ? "default" : "outline"}
              onClick={() => setMode("search")}
            >
              Search user
            </Button>
          </div>

          {!pickOnly && selected ? (
            <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5">
              <Avatar className="h-9 w-9">
                {selected.avatar_url ? (
                  <AvatarImage src={selected.avatar_url} alt="" />
                ) : null}
                <AvatarFallback>
                  {initials(displayName(selected as DebtorProfile))}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {displayName(selected as DebtorProfile)}
                </p>
                {selected.username ? (
                  <p className="truncate text-xs text-muted-foreground">
                    @{selected.username}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setSelected(null)}
              >
                Change
              </Button>
            </div>
          ) : mode === "friends" ? (
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
              {friendsLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : acceptedFriends.length === 0 ? (
                <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                  No friends yet. Search for a user instead.
                </p>
              ) : (
                acceptedFriends.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted/60"
                    onClick={() => pickPerson(f)}
                  >
                    <Avatar className="h-8 w-8">
                      {f.avatar_url ? <AvatarImage src={f.avatar_url} alt="" /> : null}
                      <AvatarFallback className="text-xs">
                        {initials(displayName(f as DebtorProfile))}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate text-sm font-medium">
                      {displayName(f as DebtorProfile)}
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="debtor-search">Find user</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="debtor-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Name or username…"
                  className="pl-9"
                  autoFocus
                />
              </div>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
                {searching ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : query.trim().length < 2 ? (
                  <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                    Type at least 2 characters
                  </p>
                ) : searchHits.filter((hit) => !hit.is_guest).length === 0 ? (
                  <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                    No users found
                  </p>
                ) : (
                  searchHits
                    .filter((hit) => !hit.is_guest)
                    .map((hit) => (
                    <button
                      key={hit.id}
                      type="button"
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted/60"
                      onClick={() => pickPerson(hit)}
                    >
                      <Avatar className="h-8 w-8">
                        {hit.avatar_url ? (
                          <AvatarImage src={hit.avatar_url} alt="" />
                        ) : null}
                        <AvatarFallback className="text-xs">
                          {initials(displayName(hit as DebtorProfile))}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {displayName(hit as DebtorProfile)}
                        </p>
                        {hit.username ? (
                          <p className="truncate text-xs text-muted-foreground">
                            @{hit.username}
                          </p>
                        ) : null}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {!pickOnly && selected ? (
            <form onSubmit={(e) => void submit(e)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="debt-amount">Amount (PHP)</Label>
                <Input
                  id="debt-amount"
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === "" || /^\d*\.?\d*$/.test(raw)) setAmount(raw);
                  }}
                  placeholder="0.00"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="debt-note">What for? (optional)</Label>
                <Textarea
                  id="debt-note"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="Lunch, ride share, borrowed cash…"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  disabled={busy}
                  onClick={requestClose}
                >
                  Cancel
                </Button>
                <Button type="submit" className="flex-1" disabled={busy || !selected}>
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Plus className="h-4 w-4" />
                      Record
                    </>
                  )}
                </Button>
              </div>
            </form>
          ) : pickOnly ? (
            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" className="flex-1" onClick={requestClose}>
                Cancel
              </Button>
            </div>
          ) : null}
        </div>
        </>
      )}
    </PalAnimatedModal>
  );
}
