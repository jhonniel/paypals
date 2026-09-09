"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft,
  Copy,
  Loader2,
  Mail,
  Search,
  UserPlus,
  Trash2,
  Receipt,
  ArrowRight,
  X,
  ZoomIn,
  Upload,
  CheckCircle2,
  Check,
  HandCoins,
  RotateCw,
  Undo2,
  MoreHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useGroupRealtime } from "@/hooks/use-realtime";
import { publicEnv } from "@/lib/env";
import { formatGroupInviteCode } from "@/lib/group-invite-code";
import {
  itemListDisplayShareAmount,
  itemSplitPerPersonAmount,
  resolveGroupSplitDivisor,
} from "@/lib/splits";
import { GroupClaimGate } from "@/features/groups/group-claim-gate";
import { GroupAddReceiptModal } from "@/features/groups/group-add-receipt-modal";
import { readApiJson } from "@/lib/api-client";
import { prepareImageFileForUpload } from "@/lib/convert-heic-client";
import {
  paymentMethodDisplayLabel,
  type PaymentMethod,
} from "@/lib/payment-methods";
import { cn } from "@/utils/cn";
import { ConfirmModal } from "@/components/confirm-modal";
import { ItemBreakdownList } from "@/components/item-breakdown-list";
import type { ReceiptSubItem } from "@/lib/receipt-sub-items";
import {
  getReceiptUnclaimedItems,
  ownerItemClaimLine,
} from "@/lib/receipt-unclaimed";
type Member = {
  id: string;
  role: string;
  user_id: string | null;
  guest_name: string | null;
  guest_email: string | null;
  invite_token: string | null;
  profiles: {
    full_name: string | null;
    username: string | null;
    avatar_url: string | null;
    email: string | null;
  } | null;
};

type GroupReceipt = {
  id: string;
  merchant: string | null;
  total: number;
  currency: string;
  status: string;
  receipt_date: string | null;
  receipt_time: string | null;
  subtotal: number;
  tax: number;
  discount: number;
  service_charge: number;
  tip: number;
  discounts?: Array<{ label: string; amount: number }>;
  notes: string | null;
  created_at: string;
  created_by: string;
  uploaded_by: string;
  has_image: boolean;
  image_url: string | null;
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    unit_price: number;
    total_price: number;
    split_mode?: string | null;
    split_n?: number | null;
    claimer_ids?: string[];
    claimed_by?: string[];
    claimed_quantity?: number;
    remaining_quantity?: number;
    claims?: Array<{ member_id: string; name: string; quantity: number }>;
    claimers_hidden?: boolean;
    others_claim_count?: number;
  }>;
};

type GroupDetail = {
  group: {
    id: string;
    name: string;
    description: string | null;
    invite_code: string;
    created_by: string;
    members_visible_to_group?: boolean;
  };
  members: Member[];
  member_count?: number;
  receipts: GroupReceipt[];
  pending_claim_receipts?: GroupReceipt[];
  must_claim_before_view?: boolean;
  my_role: string | null;
  my_member_id?: string | null;
  bill_payer_member_id?: string | null;
  members_visible_to_group?: boolean;
  can_manage_members?: boolean;
  my_payment?: {
    total: number;
    owes?: number;
    is_bill_payer?: boolean;
    currency: string;
    receipts: Array<{
      receipt_id: string;
      merchant: string | null;
      amount: number;
      currency: string;
    }>;
  } | null;
  member_payments?: Array<{
    member_id: string;
    total: number;
    owes?: number;
    is_bill_payer?: boolean;
    currency: string;
    items: Array<{
      name: string;
      quantity: number;
      amount: number;
      merchant: string | null;
      receipt_id?: string;
      sub_items?: ReceiptSubItem[];
      group_split?: boolean;
    }>;
  }>;
  where_to_pay?: Array<{
    member_id: string;
    name: string;
    methods: PaymentMethod[];
  }>;
  payment_proofs?: Array<{
    member_id: string;
    status: string;
    expected_amount: number;
    ocr_amount: number | null;
    ocr_date: string | null;
    validated_at: string | null;
    rejection_reason: string | null;
    manual?: boolean;
    bill_payer?: boolean;
    moved_to_pal?: boolean;
  }>;
  invite_url: string;
};

function money(value: number, currency = "PHP") {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function memberReceiptShare(
  payments: GroupDetail["member_payments"],
  memberId: string | null | undefined,
  receiptId: string
): number | undefined {
  if (!memberId || !payments) return undefined;
  const pay = payments.find((p) => p.member_id === memberId);
  if (!pay) return undefined;
  const lines = pay.items.filter((item) => item.receipt_id === receiptId);
  if (!lines.length) return undefined;
  return lines.reduce((sum, item) => sum + item.amount, 0);
}

function memberLabel(m: GroupDetail["members"][number]) {
  return (
    m.profiles?.full_name ||
    m.profiles?.username ||
    m.guest_name ||
    m.guest_email ||
    "Member"
  );
}

function memberPaymentStatus(
  m: GroupDetail["members"][number],
  data: Pick<GroupDetail, "member_payments" | "payment_proofs">
) {
  const pay = data.member_payments?.find((p) => p.member_id === m.id);
  const payTotal = pay?.total ?? 0;
  const owesTotal = pay?.owes ?? payTotal;
  const isBillPayer = pay?.is_bill_payer ?? false;
  const payCurrency = pay?.currency ?? "PHP";
  const proof = data.payment_proofs?.find((p) => p.member_id === m.id);
  const proofMeta = {
    manual: Boolean(proof?.manual),
    bill_payer: Boolean(proof?.bill_payer),
    moved_to_pal: Boolean(proof?.moved_to_pal),
  };
  const isMovedToPal = proofMeta.moved_to_pal && proof?.status === "paid";
  const isPaid =
    proof?.status === "paid" &&
    (isBillPayer && owesTotal <= 0
      ? proofMeta.bill_payer || proofMeta.manual
      : owesTotal > 0 &&
        (proofMeta.manual ||
          proofMeta.moved_to_pal ||
          Math.abs((proof.expected_amount ?? 0) - owesTotal) <= 1));

  return {
    pay,
    payTotal,
    owesTotal,
    isBillPayer,
    payCurrency,
    proof,
    proofMeta,
    isMovedToPal,
    isPaid,
    items: pay?.items ?? [],
  };
}

function titleCaseItem(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return name;
  // Soften ALL CAPS OCR labels for scanning
  if (trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) {
    return trimmed
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return trimmed;
}

function formatReceiptWhen(date: string | null, time: string | null) {
  if (!date) return null;
  try {
    const iso = time ? `${date}T${String(time).slice(0, 8)}` : date;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return date;
    return d.toLocaleString("en-PH", {
      month: "short",
      day: "numeric",
      year: "numeric",
      ...(time
        ? { hour: "numeric", minute: "2-digit" }
        : {}),
    });
  } catch {
    return date;
  }
}

const PREVIEW_ITEMS = 5;

type ReceiptExtraLine = {
  id: string;
  name: string;
  amount: number;
};

function receiptExtraLines(r: GroupReceipt): ReceiptExtraLine[] {
  const lines: ReceiptExtraLine[] = [];
  const discounts =
    r.discounts?.length
      ? r.discounts
      : Number(r.discount) > 0
        ? [{ label: "Discount", amount: Number(r.discount) }]
        : [];
  for (const d of discounts) {
    lines.push({
      id: `discount-${d.label}-${d.amount}`,
      name: d.label,
      amount: -Number(d.amount),
    });
  }
  if (Number(r.tax) > 0) {
    lines.push({ id: "tax", name: "Tax", amount: Number(r.tax) });
  }
  if (Number(r.service_charge) > 0) {
    lines.push({
      id: "service",
      name: "Service charge",
      amount: Number(r.service_charge),
    });
  }
  if (Number(r.tip) > 0) {
    lines.push({ id: "tip", name: "Tip", amount: Number(r.tip) });
  }
  return lines;
}

function GroupReceiptCard({
  receipt: r,
  onPickItems,
  showUnclaimed,
  groupMemberCount = 0,
  myShareAmount,
  canDelete,
  onDelete,
  deleting,
}: {
  receipt: GroupReceipt;
  onPickItems?: () => void;
  showUnclaimed?: boolean;
  groupMemberCount?: number;
  /** This member's share for the receipt (items + adjustments). */
  myShareAmount?: number | null;
  canDelete?: boolean;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [imageBroken, setImageBroken] = useState(false);
  const currency = r.currency || "PHP";
  const extraLines = receiptExtraLines(r);
  const visible = expanded ? r.items : r.items.slice(0, PREVIEW_ITEMS);
  const hiddenCount = Math.max(0, r.items.length - PREVIEW_ITEMS);
  const when = formatReceiptWhen(r.receipt_date, r.receipt_time);
  const showImage = Boolean(r.image_url) && !imageBroken;
  const unclaimed = showUnclaimed ? getReceiptUnclaimedItems(r.items) : null;
  const previewShareTotal = r.items.reduce((sum, item) => {
    const claimerCount =
      (item.claims ?? []).length ||
      (item.claimer_ids ?? []).length ||
      (item.claimed_by ?? []).length;
    return (
      sum +
      itemListDisplayShareAmount(
        Number(item.total_price),
        Number(item.quantity) || 1,
        (item.split_mode as "among_claimers" | "among_group" | "among_n") ??
          "among_n",
        item.split_n,
        groupMemberCount,
        claimerCount,
        claimerCount
      )
    );
  }, 0);
  const showMemberShare =
    myShareAmount != null && myShareAmount >= 0 && groupMemberCount > 0;
  const footerAmount = showMemberShare
    ? myShareAmount
    : previewShareTotal > 0 &&
        Math.abs(previewShareTotal - Number(r.total)) > 0.01
      ? previewShareTotal
      : Number(r.total);
  const footerLabel = showMemberShare || previewShareTotal !== Number(r.total)
    ? "Your share"
    : "Amount due";

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxOpen(false);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [lightboxOpen]);

  return (
    <article className="rounded-2xl border border-border bg-muted/15 p-3 sm:p-4">
      <div className="flex gap-3">
        {showImage ? (
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="group relative h-20 w-16 shrink-0 overflow-hidden rounded-xl bg-muted/50 ring-1 ring-border transition hover:ring-primary/50 sm:h-24 sm:w-20"
            aria-label="Enlarge receipt image"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={r.image_url!}
              alt=""
              className="h-full w-full object-cover object-top"
              onError={() => setImageBroken(true)}
            />
            <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/35">
              <ZoomIn className="h-5 w-5 text-white opacity-0 drop-shadow transition group-hover:opacity-100" />
            </span>
          </button>
        ) : (
          <div className="flex h-20 w-16 shrink-0 items-center justify-center rounded-xl bg-muted/50 text-[10px] text-muted-foreground ring-1 ring-border sm:h-24 sm:w-20">
            No img
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link
                href={`/receipts/${r.id}`}
                className="block truncate text-sm font-semibold leading-snug hover:underline sm:text-base"
              >
                {r.merchant ?? "Untitled receipt"}
              </Link>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {r.uploaded_by}
                {when ? ` · ${when}` : ""}
                {" · "}
                <span className="capitalize">{r.status.replaceAll("_", " ")}</span>
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-base font-semibold tabular-nums sm:text-lg">
                {money(Number(r.total), currency)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {r.items.length} item{r.items.length === 1 ? "" : "s"}
                {unclaimed && unclaimed.count > 0 ? (
                  <span className="ml-1 font-medium text-amber-600 dark:text-amber-400">
                    · {unclaimed.count} unclaimed
                  </span>
                ) : null}
              </p>
            </div>
          </div>
        </div>
      </div>

      {unclaimed && unclaimed.count > 0 ? (
        <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
            {unclaimed.count} item{unclaimed.count === 1 ? "" : "s"} still unclaimed
            <span className="font-normal text-amber-800/90 dark:text-amber-200/90">
              {" "}
              · about {money(unclaimed.totalValue, currency)}
            </span>
          </p>
          <ul className="mt-2 space-y-1.5">
            {unclaimed.items.map((item) => (
              <li
                key={item.id}
                className="flex items-baseline justify-between gap-2 text-xs text-amber-900/90 dark:text-amber-100/90"
              >
                <span className="min-w-0 truncate">
                  {titleCaseItem(item.name)}
                  <span className="ml-1 font-normal opacity-80">· {item.label}</span>
                </span>
                <span className="shrink-0 tabular-nums opacity-90">
                  {money(item.value, currency)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {r.items.length > 0 || extraLines.length > 0 ? (
        <div className="mt-3 max-w-lg">
          <ul className="space-y-2">
            {visible.map((item) => {
              const claims = item.claims ?? [];
              const claimLabel =
                claims.length > 0
                  ? claims
                      .map((c) =>
                        c.quantity > 1 ? `${c.name} ×${c.quantity}` : c.name
                      )
                      .join(", ")
                  : (item.claimed_by ?? []).join(", ");
              const isGroupSplit = item.split_mode === "among_group";
              const othersN = item.others_claim_count ?? 0;
              const claimerCount =
                (item.claims ?? []).length ||
                (item.claimer_ids ?? []).length ||
                (item.claimed_by ?? []).length;
              const groupPerPerson =
                isGroupSplit && groupMemberCount > 0
                  ? itemSplitPerPersonAmount(
                      Number(item.total_price),
                      "among_group",
                      null,
                      groupMemberCount,
                      claimerCount
                    )
                  : null;

              const ownerLine = showUnclaimed ? ownerItemClaimLine(item) : null;
              const claimLine = ownerLine
                ? ownerLine.line
                : isGroupSplit
                  ? groupPerPerson != null
                    ? `Split among ${resolveGroupSplitDivisor(groupMemberCount, claimerCount)} · ${money(groupPerPerson, currency)}/each`
                    : "Split with whole group"
                  : claimLabel
                    ? othersN > 0
                      ? "You claimed this · others also claimed"
                      : `Claimed by ${claimLabel}`
                    : othersN > 0 || item.claimers_hidden
                      ? "Already claimed"
                      : "Not claimed yet";
              const claimUnclaimed = ownerLine?.unclaimed ?? false;

              const displayPrice = itemListDisplayShareAmount(
                Number(item.total_price),
                Number(item.quantity) || 1,
                (item.split_mode as "among_claimers" | "among_group" | "among_n") ??
                  "among_n",
                item.split_n,
                groupMemberCount,
                claimerCount,
                claimerCount
              );
              const showShareLabel =
                Math.abs(displayPrice - Number(item.total_price)) > 0.01;

              return (
                <li
                  key={item.id}
                  className={cn(
                    "text-sm",
                    isGroupSplit &&
                      "rounded-xl border border-violet-500/30 bg-violet-500/10 px-2.5 py-2"
                  )}
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-2">
                    <span className="truncate font-medium">
                      {isGroupSplit ? (
                        <span className="mr-1.5 inline-flex rounded-full bg-violet-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-200">
                          Group
                        </span>
                      ) : null}
                      {titleCaseItem(item.name)}
                    </span>
                    <span className="tabular-nums text-xs text-muted-foreground">
                      {isGroupSplit
                        ? groupMemberCount > 0
                          ? "group"
                          : ""
                        : item.quantity !== 1
                          ? `×${item.quantity}`
                          : ""}
                    </span>
                    <span className="min-w-[4.75rem] text-right tabular-nums text-muted-foreground">
                      <span className="block font-medium text-foreground">
                        {money(displayPrice, currency)}
                      </span>
                      {showShareLabel || isGroupSplit ? (
                        <span className="text-[9px] uppercase tracking-wide">
                          {isGroupSplit ? "your share" : "share"}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <p
                    className={cn(
                      "mt-0.5 truncate text-[11px]",
                      claimUnclaimed
                        ? "font-medium text-amber-700 dark:text-amber-300"
                        : claimLabel || isGroupSplit
                          ? "text-muted-foreground"
                          : "italic text-muted-foreground/70"
                    )}
                  >
                    {claimLine}
                  </p>
                </li>
              );
            })}
            {extraLines.map((line) => (
              <li key={line.id} className="text-sm">
                <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-2">
                  <span className="truncate font-medium text-muted-foreground">
                    {line.name}
                  </span>
                  <span />
                  <span
                    className={cn(
                      "min-w-[4.75rem] text-right tabular-nums",
                      line.amount < 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-muted-foreground"
                    )}
                  >
                    {line.amount < 0
                      ? `−${money(Math.abs(line.amount), currency)}`
                      : money(line.amount, currency)}
                  </span>
                </div>
              </li>
            ))}
          </ul>

          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1.5 text-xs font-medium text-primary hover:underline"
            >
              {expanded ? "Show less" : `Show ${hiddenCount} more`}
            </button>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">No line items yet.</p>
      )}

      <div className="mt-3 flex flex-wrap items-end justify-between gap-2 border-t border-border pt-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-[auto_auto]">
          <dt className="font-medium text-foreground">{footerLabel}</dt>
          <dd className="font-semibold tabular-nums text-right text-foreground sm:text-left">
            {money(footerAmount, currency)}
          </dd>
        </dl>

        {onPickItems ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            onClick={onPickItems}
          >
            Pick what you got <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        {canDelete && onDelete ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={deleting}
            onClick={onDelete}
          >
            {deleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            Delete
          </Button>
        ) : null}
      </div>

      {lightboxOpen && showImage && r.image_url && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Receipt image"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            type="button"
            onClick={() => setLightboxOpen(false)}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={r.image_url}
            alt={r.merchant ?? "Receipt"}
            className="max-h-[90vh] max-w-[min(100%,42rem)] rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </article>
  );
}

type FriendRow = {
  id: string;
  status: string;
  requester_id: string;
  addressee_id: string;
  requester: {
    id: string;
    full_name: string | null;
    username: string | null;
    email: string | null;
  } | null;
  addressee: {
    id: string;
    full_name: string | null;
    username: string | null;
    email: string | null;
  } | null;
};

export function GroupDetailView({
  groupId,
  currentUserId,
}: {
  groupId: string;
  currentUserId: string;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  useGroupRealtime(groupId, () => {
    void qc.invalidateQueries({ queryKey: ["group", groupId] });
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["group", groupId],
    queryFn: async () => {
      const res = await fetch(`/api/groups/${groupId}`);
      const parsed = await readApiJson<{ data: GroupDetail }>(res);
      if (!parsed.ok) throw new Error(parsed.message);
      return parsed.data.data;
    },
    staleTime: 60_000,
  });

  const [inviteModalOpen, setInviteModalOpen] = useState(false);

  const { data: friends } = useQuery({
    queryKey: ["friends"],
    queryFn: async () => {
      const res = await fetch("/api/friends");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed");
      return json.data as FriendRow[];
    },
    enabled: inviteModalOpen,
    staleTime: 60_000,
  });

  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [addReceiptOpen, setAddReceiptOpen] = useState(false);
  const [claimReceiptId, setClaimReceiptId] = useState<string | null>(null);
  const [claimForMember, setClaimForMember] = useState<{
    memberId: string;
    name: string;
  } | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null);
  const [movingToPal, setMovingToPal] = useState(false);
  const [revertingMemberId, setRevertingMemberId] = useState<string | null>(null);
  const [moveToPalOpen, setMoveToPalOpen] = useState(false);
  const [selectedMoveMemberIds, setSelectedMoveMemberIds] = useState<string[]>(
    []
  );
  const [markPaidConfirm, setMarkPaidConfirm] = useState<{
    memberId: string;
    name: string;
    amountLabel: string;
    paid: boolean;
  } | null>(null);
  const [revertConfirm, setRevertConfirm] = useState<{
    memberId: string;
    name: string;
    amountLabel: string;
  } | null>(null);
  const [flippedMembers, setFlippedMembers] = useState<Set<string>>(new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState(false);
  const [deletingReceiptId, setDeletingReceiptId] = useState<string | null>(null);
  const [deleteReceiptConfirm, setDeleteReceiptConfirm] = useState<{
    receiptId: string;
    merchant: string | null;
  } | null>(null);
  const [removeMemberConfirm, setRemoveMemberConfirm] = useState<{
    memberId: string;
    name: string;
  } | null>(null);

  function toggleMemberFlip(memberId: string) {
    setFlippedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  const canManage =
    Boolean(data?.can_manage_members) ||
    data?.my_role === "owner" ||
    data?.my_role === "admin" ||
    data?.group.created_by === currentUserId;
  const isCreator =
    data?.group.created_by === currentUserId || data?.my_role === "owner";
  const isOwner = data?.my_role === "owner";
  const isBillPayer =
    Boolean(data?.my_member_id) &&
    data?.my_member_id === data?.bill_payer_member_id;
  const canMoveToPal = canManage || isBillPayer;
  const canRevertMovedToPal = canMoveToPal;
  const groupUnclaimedSummary = canManage
    ? (data?.receipts ?? []).reduce(
        (acc, receipt) => {
          const summary = getReceiptUnclaimedItems(receipt.items);
          acc.count += summary.count;
          acc.totalValue += summary.totalValue;
          if (receipt.currency) acc.currency = receipt.currency;
          return acc;
        },
        {
          count: 0,
          totalValue: 0,
          currency: data?.receipts?.[0]?.currency ?? "PHP",
        }
      )
    : null;
  const memberUserIds = new Set(
    (data?.members ?? []).map((m) => m.user_id).filter(Boolean) as string[]
  );
  const memberGuestNames = new Set(
    (data?.members ?? [])
      .map((m) => m.guest_name?.trim().toLowerCase())
      .filter(Boolean) as string[]
  );

  const acceptedFriends = (friends ?? [])
    .filter((f) => f.status === "accepted")
    .map((f) => {
      const other =
        f.requester_id === currentUserId ? f.addressee : f.requester;
      if (!other || memberUserIds.has(other.id)) return null;
      return {
        id: other.id,
        name: other.full_name || other.username || other.email || "Friend",
        username: other.username,
        email: other.email,
      };
    })
    .filter(
      (f): f is {
        id: string;
        name: string;
        username: string | null;
        email: string | null;
      } => Boolean(f)
    );

  async function copyInvite() {
    if (!data) return;
    const origin =
      typeof window !== "undefined"
        ? window.location.origin
        : publicEnv.appUrl;
    const code = data.group.invite_code?.trim();
    const url = code
      ? `${origin.replace(/\/$/, "")}/invite/${encodeURIComponent(code)}`
      : data.invite_url;
    await navigator.clipboard.writeText(url);
    toast.success("Invite link copied");
  }

  async function copyGuestLink(token: string) {
    const origin =
      typeof window !== "undefined"
        ? window.location.origin
        : publicEnv.appUrl;
    const url = `${origin.replace(/\/$/, "")}/invite/guest/${token}`;
    await navigator.clipboard.writeText(url);
    toast.success("Guest invite link copied");
  }

  async function emailGuest(email: string, token: string, name: string) {
    const origin =
      typeof window !== "undefined"
        ? window.location.origin
        : publicEnv.appUrl;
    const url = `${origin.replace(/\/$/, "")}/invite/guest/${token}`;
    const subject = encodeURIComponent(`Join ${data?.group.name ?? "our group"} on Paypals`);
    const body = encodeURIComponent(
      `Hi ${name},\n\nYou're invited to split bills with us on Paypals.\n\nClaim your seat here:\n${url}\n\nAfter you join, tap the items you ordered so the split is fair.`
    );
    window.open(`mailto:${email}?subject=${subject}&body=${body}`, "_blank");
  }

  async function addFriend(userId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "user", user_id: userId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed");
      toast.success("Friend added to group");
      setInviteModalOpen(false);
      await qc.invalidateQueries({ queryKey: ["group", groupId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function addGuestByName(name: string, email?: string | null) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "guest",
          guest_name: trimmed,
          ...(email?.trim() ? { guest_email: email.trim() } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed");
      toast.success("Member added — they’ll pick this name when they join");
      setGuestName("");
      setGuestEmail("");
      setInviteModalOpen(false);
      await qc.invalidateQueries({ queryKey: ["group", groupId] });
      if (json.data?.invite_token && email?.trim()) {
        const origin =
          typeof window !== "undefined"
            ? window.location.origin
            : publicEnv.appUrl;
        const url = `${origin.replace(/\/$/, "")}/invite/guest/${json.data.invite_token}`;
        await navigator.clipboard.writeText(url).catch(() => null);
        toast.message("Personal invite link copied");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function addGuest(e: React.FormEvent) {
    e.preventDefault();
    await addGuestByName(guestName, guestEmail);
  }

  async function addByLookup(payload: { username?: string; email?: string }) {
    setBusy(true);
    try {
      const body = payload.email
        ? { kind: "email" as const, email: payload.email.trim().toLowerCase() }
        : {
            kind: "username" as const,
            username: (payload.username ?? "").trim().replace(/^@/, ""),
          };
      const res = await fetch(`/api/groups/${groupId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed");
      toast.success("Member added");
      setInviteModalOpen(false);
      await qc.invalidateQueries({ queryKey: ["group", groupId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(memberId: string) {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/groups/${groupId}/members?member_id=${memberId}`,
        { method: "DELETE" }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed");
      toast.success("Removed");
      setRemoveMemberConfirm(null);
      await qc.invalidateQueries({ queryKey: ["group", groupId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function deleteGroup() {
    setDeletingGroup(true);
    try {
      const res = await fetch(`/api/groups/${groupId}`, { method: "DELETE" });
      const parsed = await readApiJson<{ data: { deleted: boolean } }>(res);
      if (!parsed.ok) throw new Error(parsed.message);
      toast.success("Group deleted");
      setDeleteConfirmOpen(false);
      await qc.invalidateQueries({ queryKey: ["groups"] });
      router.push("/groups");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete group");
    } finally {
      setDeletingGroup(false);
    }
  }

  async function deleteReceipt(receiptId: string) {
    setDeletingReceiptId(receiptId);
    try {
      const res = await fetch(`/api/receipts/${receiptId}`, { method: "DELETE" });
      const parsed = await readApiJson<{ data: { deleted: boolean } }>(res);
      if (!parsed.ok) throw new Error(parsed.message);
      toast.success("Receipt deleted");
      setDeleteReceiptConfirm(null);
      await qc.invalidateQueries({ queryKey: ["group", groupId] });
      await qc.invalidateQueries({ queryKey: ["groups"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete receipt");
    } finally {
      setDeletingReceiptId(null);
    }
  }

  async function updateMemberRole(memberId: string, role: "admin" | "member") {
    setBusy(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: memberId, role }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed");
      toast.success(role === "admin" ? "Made admin" : "Set as member");
      await qc.invalidateQueries({ queryKey: ["group", groupId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function setMembersVisible(visible: boolean) {
    setBusy(true);
    try {
      const res = await fetch(`/api/groups/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ members_visible_to_group: visible }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed");
      toast.success(
        visible
          ? "Members can now see everyone’s totals"
          : "Members only see their own totals"
      );
      await qc.invalidateQueries({ queryKey: ["group", groupId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function uploadPaymentProof(file: File) {
    setUploadingProof(true);
    try {
      const ready = await prepareImageFileForUpload(file);
      const form = new FormData();
      form.append("file", ready);
      const res = await fetch(`/api/groups/${groupId}/payment-proof`, {
        method: "POST",
        body: form,
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message ?? "Proof rejected");
      }
      toast.success("Payment verified — marked as paid");
      await qc.invalidateQueries({ queryKey: ["group", groupId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Proof upload failed");
      await qc.invalidateQueries({ queryKey: ["group", groupId] });
    } finally {
      setUploadingProof(false);
    }
  }

  async function markMemberPaid(memberId: string, paid: boolean) {
    setMarkingPaidId(memberId);
    try {
      const res = await fetch(`/api/groups/${groupId}/mark-paid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: memberId, paid }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed");
      toast.success(paid ? "Payment confirmed" : "Marked as unpaid");
      setMarkPaidConfirm(null);
      await qc.invalidateQueries({ queryKey: ["group", groupId] });
      await qc.invalidateQueries({ queryKey: ["friends-balances"] });
      await qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setMarkingPaidId(null);
    }
  }

  async function moveMembersToPalDebt(memberIds: string[]) {
    if (memberIds.length === 0) return;
    setMovingToPal(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/move-to-pal-debt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_ids: memberIds }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed");

      const moved = (json.data?.moved ?? []) as Array<{ amount: number }>;
      const failed = (json.data?.failed ?? []) as Array<{ error: string }>;
      const total = Number(json.data?.total_amount ?? 0);
      const currency = (json.data?.currency as string) ?? "PHP";

      if (failed.length > 0 && moved.length > 0) {
        toast.success(
          `Moved ${moved.length} member${moved.length === 1 ? "" : "s"} (${money(total, currency)}) · ${failed.length} skipped`
        );
      } else {
        toast.success(
          moved.length === 1
            ? "Moved to Pal owes me — they no longer owe in this group"
            : `Moved ${moved.length} members (${money(total, currency)}) to Pal owes me`
        );
      }

      setMoveToPalOpen(false);
      setSelectedMoveMemberIds([]);
      await qc.invalidateQueries({ queryKey: ["group", groupId] });
      await qc.invalidateQueries({ queryKey: ["friends-balances"] });
      await qc.invalidateQueries({ queryKey: ["pal-debts"] });
      await qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setMovingToPal(false);
    }
  }

  async function revertMemberFromPalDebt(memberId: string) {
    setRevertingMemberId(memberId);
    try {
      const res = await fetch(`/api/groups/${groupId}/revert-from-pal-debt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: memberId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed");
      toast.success("Reverted — they owe in this group again");
      setRevertConfirm(null);
      await qc.invalidateQueries({ queryKey: ["group", groupId] });
      await qc.invalidateQueries({ queryKey: ["pal-debts"] });
      await qc.invalidateQueries({ queryKey: ["dashboard"] });
      await qc.invalidateQueries({ queryKey: ["groups"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setRevertingMemberId(null);
    }
  }

  async function renameMember(memberId: string, currentName: string) {
    const next = window.prompt("Name on the bill", currentName)?.trim();
    if (!next || next === currentName) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: memberId, guest_name: next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed");
      toast.success("Name updated");
      await qc.invalidateQueries({ queryKey: ["group", groupId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const moveToPalMembers = useMemo(() => {
    if (!data) return [];
    return data.members
      .filter((m) => m.id !== data.my_member_id)
      .map((m) => {
        const status = memberPaymentStatus(m, data);
        let ineligibleReason: string | null = null;
        if (!m.user_id) {
          ineligibleReason = "Needs a Paypals account";
        } else if (status.isMovedToPal) {
          ineligibleReason = "Already moved to Pal owes me";
        } else if (status.isPaid) {
          ineligibleReason = "Already marked paid";
        } else if (status.owesTotal <= 0) {
          ineligibleReason = "Nothing owed in this group";
        }
        return {
          memberId: m.id,
          name: memberLabel(m),
          owesTotal: status.owesTotal,
          currency: status.payCurrency,
          eligible: ineligibleReason == null,
          ineligibleReason,
        };
      });
  }, [data]);

  const moveToPalEligible = moveToPalMembers.filter((m) => m.eligible);

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error || !data) {
    return (
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : "Not found"}
      </p>
    );
  }

  if (data.must_claim_before_view && (data.pending_claim_receipts?.length ?? 0) > 0) {
    return (
      <GroupClaimGate
        groupId={groupId}
        groupName={data.group.name}
        receipts={data.pending_claim_receipts!}
        myMemberId={data.my_member_id}
        memberCount={data.member_count ?? data.members.length}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/groups"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Groups
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {data.group.name}
            </h1>
            {data.group.description && (
              <p className="mt-1 text-sm text-muted-foreground">
                {data.group.description}
              </p>
            )}
          </div>
          {isOwner ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 shrink-0"
                  aria-label="Group options"
                >
                  <MoreHorizontal className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  disabled={deletingGroup}
                  onClick={() => setDeleteConfirmOpen(true)}
                >
                  {deletingGroup ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  Delete group…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-2 space-y-0 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">Receipts ({data.receipts?.length ?? 0})</CardTitle>
            <CardDescription>
              {canManage && (groupUnclaimedSummary?.count ?? 0) > 0 ? (
                <>
                  <span className="font-medium text-amber-700 dark:text-amber-300">
                    {groupUnclaimedSummary!.count} item
                    {groupUnclaimedSummary!.count === 1 ? "" : "s"} still unclaimed
                    {" · "}
                    about {money(groupUnclaimedSummary!.totalValue, groupUnclaimedSummary!.currency)}
                  </span>
                  <span className="mt-0.5 block text-muted-foreground">
                    See which lines are open below — assign from a member tile if needed.
                  </span>
                </>
              ) : isCreator ? (
                "Upload or enter receipts manually — members tap what they ordered"
              ) : (
                "Open a receipt and tap what you got"
              )}
            </CardDescription>
          </div>
          {isCreator && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start sm:self-auto"
              onClick={() => setAddReceiptOpen(true)}
            >
              <Receipt className="h-3.5 w-3.5" />
              Add receipt
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          {(data.receipts?.length ?? 0) === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                {isCreator
                  ? "No receipts yet. Scan, attach a photo, or enter items manually."
                  : "No receipts yet. Only the group creator can upload — check back soon."}
              </p>
              {isCreator && (
                <Button
                  type="button"
                  className="mt-4"
                  variant="outline"
                  onClick={() => setAddReceiptOpen(true)}
                >
                  Add a receipt
                </Button>
              )}
            </div>
          ) : (
            data.receipts.map((r) => (
              <GroupReceiptCard
                key={r.id}
                receipt={r}
                groupMemberCount={data.member_count ?? data.members.length}
                myShareAmount={memberReceiptShare(
                  data.member_payments,
                  data.my_member_id,
                  r.id
                )}
                showUnclaimed={canManage}
                canDelete={r.created_by === currentUserId}
                deleting={deletingReceiptId === r.id}
                onDelete={() =>
                  setDeleteReceiptConfirm({
                    receiptId: r.id,
                    merchant: r.merchant,
                  })
                }
                onPickItems={
                  data.my_member_id
                    ? () => setClaimReceiptId(r.id)
                    : undefined
                }
              />
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 space-y-0 p-4 sm:p-6">
          <div className="flex flex-row items-start justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="text-base">
                {canManage || data.members_visible_to_group
                  ? `Members (${data.member_count ?? data.members.length})`
                  : "Your share"}
              </CardTitle>
              <CardDescription>
                {canManage
                  ? data.members_visible_to_group
                    ? "Everyone can see all members’ totals"
                    : "Members only see their own tile — you see everyone"
                  : data.members_visible_to_group
                    ? "Everyone’s totals in this group"
                    : "Only your total and items are shown"}
              </CardDescription>
            </div>
            {canManage ? (
              <Button
                type="button"
                size="sm"
                className="shrink-0"
                onClick={() => setInviteModalOpen(true)}
              >
                <UserPlus className="h-3.5 w-3.5" />
                Manage
              </Button>
            ) : null}
          </div>
          {canMoveToPal ? (
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full justify-center sm:w-auto"
                disabled={busy || movingToPal}
                onClick={() => {
                  setSelectedMoveMemberIds(
                    moveToPalEligible.map((m) => m.memberId)
                  );
                  setMoveToPalOpen(true);
                }}
              >
                <HandCoins className="h-3.5 w-3.5" />
                Move to Pal owes me
              </Button>
              {!isBillPayer && canManage ? (
                <p className="text-[11px] text-muted-foreground">
                  Balance is added to the bill payer&apos;s Pal owes me list.
                </p>
              ) : null}
              {canManage ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/30 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium">Visible to group</p>
                <p className="text-xs text-muted-foreground">
                  Let everyone see each member’s pays and items
                </p>
              </div>
              <Switch
                checked={Boolean(data.members_visible_to_group)}
                disabled={busy}
                onCheckedChange={(v) => void setMembersVisible(v)}
              />
            </div>
              ) : null}
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.members.map((m) => {
              const label = memberLabel(m);
              const isGuest = Boolean(m.guest_name && !m.user_id);
              const isMe = m.id === data.my_member_id;
              const isOwnerSeat = m.role === "owner";
              const {
                payTotal,
                owesTotal,
                isBillPayer,
                payCurrency,
                proof,
                proofMeta,
                isMovedToPal,
                isPaid,
                items,
              } = memberPaymentStatus(m, data);
              const initial = label.trim().charAt(0).toUpperCase() || "?";
              const canFlip = (canManage || isMe) && items.length > 0;
              const isFlipped = canFlip && flippedMembers.has(m.id);
              return (
                <div key={m.id} className="[perspective:1400px]">
                <div
                  className={cn(
                    "grid transition-transform duration-500 [transform-style:preserve-3d]",
                    isFlipped && "[transform:rotateY(180deg)]"
                  )}
                >
                <div
                  className={cn(
                    "col-start-1 row-start-1 flex flex-col rounded-2xl border p-3 [backface-visibility:hidden]",
                    isFlipped && "pointer-events-none",
                    isMe
                      ? "border-primary/40 bg-primary/10"
                      : "border-border/80 bg-muted/30"
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <div
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                        isMe
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground"
                      )}
                      aria-hidden
                    >
                      {initial}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold leading-tight">
                        {label}
                        {isMe ? (
                          <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                            you
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] capitalize text-muted-foreground">
                        {m.role}
                        {isGuest ? " · waiting" : ""}
                        {m.guest_name && m.user_id
                          ? ` · as ${m.guest_name}`
                          : ""}
                      </p>
                    </div>
                    {canFlip && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0 text-muted-foreground"
                        aria-label="Show items"
                        onClick={() => toggleMemberFlip(m.id)}
                      >
                        <RotateCw className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  {(canManage || isMe) && payTotal > 0 && (
                    <div className="mt-3 rounded-xl bg-background/60 px-3 py-2 text-center">
                      {isBillPayer && owesTotal <= 0 ? (
                        <>
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary">
                            <CheckCircle2 className="h-4 w-4" />
                            {isMe ? "You paid the bill" : "Bill payer"}
                          </span>
                          <p className="mt-2 text-xl font-semibold tabular-nums tracking-tight">
                            {money(payTotal, payCurrency)}
                          </p>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            {isMe ? "Your share at the table" : "Share at the table"}
                          </p>
                        </>
                      ) : isPaid ? (
                        <span className="inline-flex flex-col items-center gap-1">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold",
                              isMovedToPal
                                ? "bg-violet-500/15 text-violet-700 dark:text-violet-300"
                                : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                            )}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            {isMovedToPal ? "Moved to Pal owes me" : "Paid"}
                            {!isMovedToPal && proof?.manual ? (
                              <span className="font-normal opacity-80">· manual</span>
                            ) : null}
                          </span>
                          {isMovedToPal ? (
                            <>
                              <span className="text-[10px] text-muted-foreground">
                                Balance tracked outside this group
                              </span>
                              {canRevertMovedToPal ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="mt-1.5 h-7 gap-1.5 border-violet-500/30 px-2.5 text-[11px] text-violet-700 hover:bg-violet-500/10 dark:text-violet-300"
                                  disabled={
                                    busy ||
                                    movingToPal ||
                                    revertingMemberId === m.id
                                  }
                                  onClick={() =>
                                    setRevertConfirm({
                                      memberId: m.id,
                                      name: label,
                                      amountLabel: money(
                                        proof?.expected_amount ?? owesTotal,
                                        payCurrency
                                      ),
                                    })
                                  }
                                >
                                  {revertingMemberId === m.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <>
                                      <Undo2 className="h-3.5 w-3.5" />
                                      Revert to group
                                    </>
                                  )}
                                </Button>
                              ) : (
                                <span className="mt-1 text-[10px] text-muted-foreground">
                                  Only the group owner or bill payer can revert
                                </span>
                              )}
                            </>
                          ) : null}
                        </span>
                      ) : (
                        <>
                          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            {isMe && !canManage ? "You owe in this group" : "Pays"}
                          </p>
                          <p className="text-xl font-semibold tabular-nums tracking-tight">
                            {money(owesTotal, payCurrency)}
                          </p>
                        </>
                      )}
                    </div>
                  )}

                  {canFlip && (
                    <button
                      type="button"
                      className="mt-2 text-left text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                      onClick={() => toggleMemberFlip(m.id)}
                    >
                      View {items.length} item{items.length === 1 ? "" : "s"} →
                    </button>
                  )}

                  {isMe &&
                    owesTotal > 0 &&
                    !isPaid &&
                    (data.where_to_pay?.filter(
                      (payer) => payer.member_id !== data.my_member_id
                    ).length ?? 0) > 0 && (
                    <div className="mt-2 space-y-2 rounded-xl border border-border/60 bg-background/40 px-3 py-2.5">
                      {data
                        .where_to_pay!.filter(
                          (payer) => payer.member_id !== data.my_member_id
                        )
                        .map((payer) => (
                        <div key={payer.member_id} className="space-y-2">
                          {payer.methods.map((method) => (
                            <div
                              key={method.id}
                              className="space-y-3 rounded-lg bg-muted/40 px-3 py-3"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                    Send payment to
                                  </p>
                                  <p className="text-sm font-semibold leading-tight">
                                    {payer.name}
                                  </p>
                                </div>
                                <div className="shrink-0 text-right">
                                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                    Type
                                  </p>
                                  <p className="mt-0.5 text-sm font-semibold">
                                    {paymentMethodDisplayLabel(method)}
                                  </p>
                                </div>
                              </div>
                              {method.account_number ? (
                                <div>
                                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                    Account number
                                  </p>
                                  <div className="mt-1 flex items-center gap-2">
                                    <p className="min-w-0 flex-1 break-all font-mono text-base font-semibold tabular-nums tracking-wide">
                                      {method.account_number}
                                    </p>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="h-9 shrink-0 gap-1.5 px-3 text-sm font-medium"
                                      onClick={() => {
                                        const number = method.account_number?.trim();
                                        if (!number) {
                                          toast.error("No account number to copy");
                                          return;
                                        }
                                        void navigator.clipboard.writeText(number).then(
                                          () => toast.success("Number copied"),
                                          () => toast.error("Could not copy")
                                        );
                                      }}
                                    >
                                      <Copy className="h-4 w-4" />
                                      Copy
                                    </Button>
                                  </div>
                                </div>
                              ) : null}
                              {method.qr_code_url ? (
                                <div>
                                  <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                    QR code
                                  </p>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={method.qr_code_url}
                                    alt={`Pay ${method.account_name || paymentMethodDisplayLabel(method)} QR`}
                                    className="mx-auto h-40 w-40 rounded-xl border border-border bg-white object-contain p-2"
                                  />
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}

                  {isMe &&
                    owesTotal > 0 &&
                    (data.where_to_pay?.filter(
                      (payer) => payer.member_id !== data.my_member_id
                    ).length ?? 0) === 0 &&
                    canManage && (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Add receiving accounts in{" "}
                        <Link href="/settings" className="underline">
                          Settings
                        </Link>{" "}
                        so members know where to pay.
                      </p>
                    )}

                  {isMe &&
                    owesTotal > 0 &&
                    (data.where_to_pay?.filter(
                      (payer) => payer.member_id !== data.my_member_id
                    ).length ?? 0) === 0 &&
                    !canManage && (
                      <p className="mt-2 text-[11px] italic text-muted-foreground/80">
                        Ask the payer to add their GCash/bank in Settings.
                      </p>
                    )}

                  {isMe && owesTotal > 0 && !isPaid && (
                    <div className="mt-2 space-y-1.5">
                      <label className="flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border border-dashed border-border bg-muted/20 px-3 py-3 text-center hover:bg-muted/40">
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif,.heic,.heif"
                          className="sr-only"
                          disabled={uploadingProof}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void uploadPaymentProof(file);
                            e.target.value = "";
                          }}
                        />
                        {uploadingProof ? (
                          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Checking proof…
                          </span>
                        ) : (
                          <>
                            <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                              <Upload className="h-4 w-4" />
                              Upload payment proof
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              Screenshot must show {money(owesTotal, payCurrency)}{" "}
                              and today’s date (Asia/Manila)
                            </span>
                          </>
                        )}
                      </label>
                      {proof?.status === "rejected" && proof.rejection_reason ? (
                        <p className="text-[11px] text-destructive">
                          {proof.rejection_reason}
                        </p>
                      ) : null}
                    </div>
                  )}

                  {canManage &&
                    (owesTotal > 0 || (data.receipts?.length ?? 0) > 0) && (
                      <div className="mt-2 flex flex-col gap-1.5">
                        {owesTotal > 0 && !isMovedToPal && (
                          <Button
                            type="button"
                            size="sm"
                            variant={isPaid ? "outline" : "secondary"}
                            className="h-8 min-w-0 w-full px-2 text-[11px]"
                            disabled={busy || markingPaidId === m.id}
                            onClick={() =>
                              setMarkPaidConfirm({
                                memberId: m.id,
                                name: label,
                                amountLabel: money(owesTotal, payCurrency),
                                paid: !isPaid,
                              })
                            }
                          >
                            {markingPaidId === m.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : isPaid ? (
                              "Mark unpaid"
                            ) : (
                              "Mark as paid"
                            )}
                          </Button>
                        )}
                        {(data.receipts?.length ?? 0) > 0 && (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="h-8 min-w-0 w-full px-2 text-[11px]"
                            onClick={() =>
                              setClaimForMember({ memberId: m.id, name: label })
                            }
                          >
                            Assign items
                          </Button>
                        )}
                      </div>
                    )}

                  {canManage && !isOwnerSeat && (
                    <div className="mt-3 flex flex-wrap gap-1 border-t border-border/50 pt-2">
                      {(isGuest || m.guest_name) && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={busy}
                          onClick={() =>
                            void renameMember(m.id, m.guest_name || label)
                          }
                        >
                          Rename
                        </Button>
                      )}
                      {m.user_id && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={busy}
                          onClick={() =>
                            void updateMemberRole(
                              m.id,
                              m.role === "admin" ? "member" : "admin"
                            )
                          }
                        >
                          {m.role === "admin" ? "Make member" : "Make admin"}
                        </Button>
                      )}
                      {isGuest && m.invite_token && (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => void copyGuestLink(m.invite_token!)}
                          >
                            <Copy className="h-3 w-3" />
                            Link
                          </Button>
                          {m.guest_email && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              onClick={() =>
                                emailGuest(
                                  m.guest_email!,
                                  m.invite_token!,
                                  m.guest_name || "there"
                                )
                              }
                            >
                              <Mail className="h-3 w-3" />
                              Email
                            </Button>
                          )}
                        </>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                        disabled={busy}
                        onClick={() =>
                          setRemoveMemberConfirm({ memberId: m.id, name: label })
                        }
                      >
                        <Trash2 className="h-3 w-3" />
                        Remove
                      </Button>
                    </div>
                  )}
                </div>

                {/* Back — item breakdown */}
                <div
                  className={cn(
                    "col-start-1 row-start-1 flex flex-col rounded-2xl border p-3 [backface-visibility:hidden] [transform:rotateY(180deg)]",
                    !isFlipped && "pointer-events-none",
                    isMe
                      ? "border-primary/40 bg-primary/10"
                      : "border-border/80 bg-muted/30"
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <div
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                        isMe
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground"
                      )}
                      aria-hidden
                    >
                      {initial}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold leading-tight">
                        {label}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {items.length} item{items.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0 text-muted-foreground"
                      aria-label="Back to summary"
                      onClick={() => toggleMemberFlip(m.id)}
                    >
                      <RotateCw className="h-4 w-4 -scale-x-100" />
                    </Button>
                  </div>

                  <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
                    {items.length > 0 ? (
                      <ItemBreakdownList
                        items={items}
                        currency={payCurrency}
                        titleCase={titleCaseItem}
                        total={payTotal}
                        showTotal={
                          isPaid || (isBillPayer && owesTotal <= 0)
                        }
                        hideSubItemAmounts
                      />
                    ) : (
                      <p className="text-[11px] italic text-muted-foreground/70">
                        No items yet
                      </p>
                    )}
                  </div>
                </div>
                </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {addReceiptOpen && data && (
        <GroupAddReceiptModal
          groupId={groupId}
          groupName={data.group.name}
          onClose={() => setAddReceiptOpen(false)}
          onLinked={async () => {
            await qc.invalidateQueries({ queryKey: ["group", groupId] });
          }}
        />
      )}

      {inviteModalOpen && (
        <InviteMembersModal
          busy={busy}
          canManage={Boolean(canManage)}
          inviteUrl={data.invite_url}
          inviteCode={data.group.invite_code}
          friends={acceptedFriends}
          memberUserIds={memberUserIds}
          memberGuestNames={memberGuestNames}
          guestName={guestName}
          guestEmail={guestEmail}
          onCopyInvite={() => void copyInvite()}
          onGuestNameChange={setGuestName}
          onGuestEmailChange={setGuestEmail}
          onAddFriend={(id) => void addFriend(id)}
          onAddGuestByName={(name, email) => void addGuestByName(name, email)}
          onAddByLookup={(payload) => void addByLookup(payload)}
          onAddGuest={(e) => void addGuest(e)}
          onClose={() => setInviteModalOpen(false)}
        />
      )}

      {deleteConfirmOpen && data && (
        <DeleteGroupConfirmModal
          groupName={data.group.name}
          busy={deletingGroup}
          onConfirm={() => void deleteGroup()}
          onClose={() => {
            if (deletingGroup) return;
            setDeleteConfirmOpen(false);
          }}
        />
      )}

      {markPaidConfirm && (
        <MarkPaidConfirmModal
          name={markPaidConfirm.name}
          amountLabel={markPaidConfirm.amountLabel}
          paid={markPaidConfirm.paid}
          busy={markingPaidId === markPaidConfirm.memberId}
          onConfirm={() =>
            void markMemberPaid(markPaidConfirm.memberId, markPaidConfirm.paid)
          }
          onClose={() => {
            if (markingPaidId) return;
            setMarkPaidConfirm(null);
          }}
        />
      )}

      {revertConfirm && (
        <ConfirmModal
          title="Revert to group?"
          description="This removes the balance from Pal owes me and marks them as owing in this group again."
          highlight={
            <p className="text-sm font-medium">
              {revertConfirm.name} · {revertConfirm.amountLabel}
            </p>
          }
          highlightClassName="border-violet-500/30 bg-violet-500/5"
          confirmLabel="Revert to group"
          busy={revertingMemberId === revertConfirm.memberId}
          onConfirm={() =>
            void revertMemberFromPalDebt(revertConfirm.memberId)
          }
          onClose={() => {
            if (revertingMemberId) return;
            setRevertConfirm(null);
          }}
        />
      )}

      {moveToPalOpen && data && (
        <MoveToPalMemberModal
          groupName={data.group.name}
          members={moveToPalMembers}
          selectedMemberIds={selectedMoveMemberIds}
          onToggleMember={(memberId) => {
            setSelectedMoveMemberIds((prev) =>
              prev.includes(memberId)
                ? prev.filter((id) => id !== memberId)
                : [...prev, memberId]
            );
          }}
          onSelectAllEligible={() => {
            setSelectedMoveMemberIds(
              moveToPalEligible.map((m) => m.memberId)
            );
          }}
          onClearSelection={() => setSelectedMoveMemberIds([])}
          busy={movingToPal}
          onConfirm={() => void moveMembersToPalDebt(selectedMoveMemberIds)}
          onClose={() => {
            if (movingToPal) return;
            setMoveToPalOpen(false);
            setSelectedMoveMemberIds([]);
          }}
        />
      )}

      {deleteReceiptConfirm && (
        <ConfirmModal
          title="Delete receipt?"
          description="All items and splits on this receipt will be removed. This cannot be undone."
          highlight={
            <>
              <p className="text-sm font-medium">
                {deleteReceiptConfirm.merchant?.trim() || "Untitled receipt"}
              </p>
            </>
          }
          highlightClassName="border-destructive/30 bg-destructive/5"
          confirmLabel="Delete receipt"
          variant="destructive"
          busy={deletingReceiptId === deleteReceiptConfirm.receiptId}
          onConfirm={() => void deleteReceipt(deleteReceiptConfirm.receiptId)}
          onClose={() => {
            if (deletingReceiptId) return;
            setDeleteReceiptConfirm(null);
          }}
        />
      )}

      {removeMemberConfirm && (
        <ConfirmModal
          title="Remove member?"
          description="They will lose access to this group and their claims on receipts."
          highlight={
            <p className="text-sm font-medium">{removeMemberConfirm.name}</p>
          }
          confirmLabel="Remove member"
          variant="destructive"
          busy={busy}
          onConfirm={() => void removeMember(removeMemberConfirm.memberId)}
          onClose={() => {
            if (busy) return;
            setRemoveMemberConfirm(null);
          }}
        />
      )}

      {claimReceiptId &&
        (() => {
          const receipt = data.receipts.find((r) => r.id === claimReceiptId);
          if (!receipt) return null;
          const claimReceipt = {
            id: receipt.id,
            merchant: receipt.merchant,
            currency: receipt.currency,
            total: receipt.total,
            uploaded_by: receipt.uploaded_by,
            items: receipt.items,
          };
          return createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Pick what you got"
              className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
              onClick={() => setClaimReceiptId(null)}
            >
              <div
                className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-border bg-background p-4 shadow-2xl sm:rounded-3xl sm:p-6"
                onClick={(e) => e.stopPropagation()}
              >
                <GroupClaimGate
                  groupId={groupId}
                  groupName={data.group.name}
                  receipts={[claimReceipt]}
                  myMemberId={data.my_member_id}
                  memberCount={data.member_count ?? data.members.length}
                  variant="modal"
                  onClose={() => setClaimReceiptId(null)}
                />
              </div>
            </div>,
            document.body
          );
        })()}

      {claimForMember && (data.receipts?.length ?? 0) > 0 &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Assign items for ${claimForMember.name}`}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
            onClick={() => setClaimForMember(null)}
          >
            <div
              className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-border bg-background p-4 shadow-2xl sm:rounded-3xl sm:p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <GroupClaimGate
                groupId={groupId}
                groupName={data.group.name}
                receipts={data.receipts.map((r) => ({
                  id: r.id,
                  merchant: r.merchant,
                  currency: r.currency,
                  total: r.total,
                  uploaded_by: r.uploaded_by,
                  items: r.items,
                }))}
                myMemberId={data.my_member_id}
                forMemberId={claimForMember.memberId}
                forMemberName={claimForMember.name}
                memberCount={data.member_count ?? data.members.length}
                variant="modal"
                onClose={() => setClaimForMember(null)}
              />
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

function InviteMembersModal({
  busy,
  canManage,
  inviteUrl,
  inviteCode,
  friends,
  memberUserIds,
  memberGuestNames,
  guestName,
  guestEmail,
  onCopyInvite,
  onGuestNameChange,
  onGuestEmailChange,
  onAddFriend,
  onAddGuestByName,
  onAddByLookup,
  onAddGuest,
  onClose,
}: {
  busy: boolean;
  canManage: boolean;
  inviteUrl: string;
  inviteCode: string;
  friends: Array<{
    id: string;
    name: string;
    username: string | null;
    email: string | null;
  }>;
  memberUserIds: Set<string>;
  memberGuestNames: Set<string>;
  guestName: string;
  guestEmail: string;
  onCopyInvite: () => void;
  onGuestNameChange: (v: string) => void;
  onGuestEmailChange: (v: string) => void;
  onAddFriend: (id: string) => void;
  onAddGuestByName: (name: string, email?: string | null) => void;
  onAddByLookup: (payload: { username?: string; email?: string }) => void;
  onAddGuest: (e: React.FormEvent) => void;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [userQuery, setUserQuery] = useState("");
  const [friendFilter, setFriendFilter] = useState("");

  const searchQ = userQuery.trim();
  const { data: searchHits, isFetching: searchingUsers } = useQuery({
    queryKey: ["invite-user-search", searchQ],
    enabled: searchQ.length >= 2,
    queryFn: async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(searchQ)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Search failed");
      return (json.data?.people ?? []) as Array<{
        id: string;
        full_name: string | null;
        username: string | null;
        email: string | null;
        avatar_url: string | null;
        is_guest?: boolean;
        guest_name?: string | null;
      }>;
    },
    staleTime: 15_000,
  });

  const filteredFriends = friends.filter((f) => {
    const q = friendFilter.trim().toLowerCase();
    if (!q) return true;
    return [f.name, f.username, f.email]
      .filter(Boolean)
      .some((part) => String(part).toLowerCase().includes(q));
  });

  const people = (searchHits ?? []).filter((p) => {
    if (p.is_guest) {
      const name = (p.guest_name || p.full_name || "").trim().toLowerCase();
      return name.length > 0 && !memberGuestNames.has(name);
    }
    return !memberUserIds.has(p.id);
  });

  async function onSubmitUserLookup(e: React.FormEvent) {
    e.preventDefault();
    const raw = userQuery.trim().replace(/^@/, "");
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
    if (isEmail) {
      await onAddByLookup({ email: raw });
      setUserQuery("");
      return;
    }
    if (raw.length < 3) {
      toast.error("Enter at least 3 characters, or pick someone from the list");
      return;
    }
    await onAddByLookup({ username: raw });
    setUserQuery("");
  }

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
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
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-members-title"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div
        className="relative z-[1] flex max-h-[min(88dvh,36rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
        style={{ marginBottom: "max(0px, env(safe-area-inset-bottom))" }}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 id="invite-members-title" className="text-base font-semibold">
              Invite & add
            </h2>
            <p className="text-xs text-muted-foreground">
              Share the link or add people directly
            </p>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-10 w-10 shrink-0"
            aria-label="Close"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 [-webkit-overflow-scrolling:touch]">
          <div className="space-y-5 pb-2">
            <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-3">
              <div className="flex items-start gap-3">
                <div className="shrink-0 rounded-lg bg-white p-2 [&_svg]:h-[72px] [&_svg]:w-[72px] sm:[&_svg]:h-[88px] sm:[&_svg]:w-[88px]">
                  <QRCodeSVG value={inviteUrl} size={88} />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Share the link, QR, or 6-character code. Friends can open the link or go to
                    Groups → Join with code.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm text-muted-foreground">Code</p>
                    <span className="rounded-md bg-muted px-2.5 py-1 font-mono text-lg font-semibold tracking-[0.2em]">
                      {formatGroupInviteCode(inviteCode)}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(
                            formatGroupInviteCode(inviteCode)
                          );
                          toast.success("Code copied");
                        } catch {
                          toast.error("Could not copy");
                        }
                      }}
                    >
                      <Copy className="h-3 w-3" />
                      Copy code
                    </Button>
                  </div>
                  <p className="break-all text-[11px] text-muted-foreground">
                    {inviteUrl}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onCopyInvite}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy link
                  </Button>
                </div>
              </div>
            </div>

            {canManage && (
              <>
                {friends.length > 0 && (
                  <div className="space-y-2">
                    <Label>Friends</Label>
                    {friends.length > 4 ? (
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={friendFilter}
                          onChange={(e) => setFriendFilter(e.target.value)}
                          placeholder="Filter friends…"
                          className="pl-9"
                          autoComplete="off"
                        />
                      </div>
                    ) : null}
                    {filteredFriends.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No friends match your filter.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {filteredFriends.map((f) => (
                          <Button
                            key={f.id}
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => onAddFriend(f.id)}
                            title={[f.username ? `@${f.username}` : null, f.email]
                              .filter(Boolean)
                              .join(" · ")}
                          >
                            <UserPlus className="h-3.5 w-3.5" />
                            {f.name}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <form onSubmit={(e) => void onSubmitUserLookup(e)} className="space-y-2">
                  <Label htmlFor="add-user-search">Find user</Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="add-user-search"
                      value={userQuery}
                      onChange={(e) => setUserQuery(e.target.value)}
                      placeholder="Search name, username, email, or guest…"
                      className="pl-9"
                      autoComplete="off"
                    />
                    {searchingUsers ? (
                      <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                    ) : null}
                  </div>

                  {searchQ.length >= 2 ? (
                    <div className="overflow-hidden rounded-xl border border-border bg-muted/20">
                      {people.length === 0 && !searchingUsers ? (
                        <p className="px-4 py-3 text-sm text-muted-foreground">
                          No users match “{searchQ}”
                        </p>
                      ) : (
                        <ul className="divide-y divide-border">
                          {people.map((p) => {
                            const isGuest = Boolean(p.is_guest);
                            const label =
                              p.full_name || p.guest_name || p.username || p.email || "User";
                            const inGroup = isGuest
                              ? memberGuestNames.has(label.trim().toLowerCase())
                              : memberUserIds.has(p.id);
                            return (
                              <li
                                key={p.id}
                                className="flex items-center justify-between gap-3 px-3 py-2.5"
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">
                                    {label}
                                    {isGuest ? (
                                      <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                                        guest
                                      </span>
                                    ) : null}
                                  </p>
                                  <p className="truncate text-xs text-muted-foreground">
                                    {isGuest
                                      ? p.email || "Guest seat from your groups"
                                      : [
                                          p.username ? `@${p.username}` : null,
                                          p.email,
                                        ]
                                          .filter(Boolean)
                                          .join(" · ") || "No username"}
                                  </p>
                                </div>
                                {inGroup ? (
                                  <span className="shrink-0 text-xs text-muted-foreground">
                                    In group
                                  </span>
                                ) : (
                                  <Button
                                    type="button"
                                    size="sm"
                                    disabled={busy}
                                    onClick={() =>
                                      isGuest
                                        ? void onAddGuestByName(
                                            p.guest_name || p.full_name || label,
                                            p.email
                                          )
                                        : onAddFriend(p.id)
                                    }
                                  >
                                    {busy ? (
                                      <Loader2 className="animate-spin" />
                                    ) : (
                                      <UserPlus className="h-3.5 w-3.5" />
                                    )}
                                    Add
                                  </Button>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  ) : null}

                  {searchQ.length > 0 && searchQ.length < 2 ? (
                    <p className="text-xs text-muted-foreground">
                      Type at least 2 characters to search, or enter an exact
                      username / email below.
                    </p>
                  ) : null}

                  <Button
                    type="submit"
                    disabled={
                      busy ||
                      (() => {
                        const raw = userQuery.trim().replace(/^@/, "");
                        if (!raw) return true;
                        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return false;
                        return raw.length < 3;
                      })()
                    }
                    className="w-full"
                    size="sm"
                    variant="outline"
                  >
                    {busy ? <Loader2 className="animate-spin" /> : <UserPlus />}
                    Add by exact username or email
                  </Button>
                </form>

                <form onSubmit={onAddGuest} className="space-y-2">
                  <Label>Add a name on the bill</Label>
                  <Input
                    value={guestName}
                    onChange={(e) => onGuestNameChange(e.target.value)}
                    placeholder="e.g. Morgan, Alex…"
                    required
                  />
                  <Input
                    type="email"
                    value={guestEmail}
                    onChange={(e) => onGuestEmailChange(e.target.value)}
                    placeholder="Email (optional)"
                  />
                  <Button
                    type="submit"
                    disabled={busy || !guestName.trim()}
                    className="w-full"
                    size="sm"
                  >
                    {busy ? <Loader2 className="animate-spin" /> : <UserPlus />}
                    Add member
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    When they join with the group link, they can pick this name if it
                    matches — or skip and join without picking.
                  </p>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function MoveToPalMemberModal({
  groupName,
  members,
  selectedMemberIds,
  onToggleMember,
  onSelectAllEligible,
  onClearSelection,
  busy,
  onConfirm,
  onClose,
}: {
  groupName: string;
  members: Array<{
    memberId: string;
    name: string;
    owesTotal: number;
    currency: string;
    eligible: boolean;
    ineligibleReason: string | null;
  }>;
  selectedMemberIds: string[];
  onToggleMember: (memberId: string) => void;
  onSelectAllEligible: () => void;
  onClearSelection: () => void;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const selectedSet = useMemo(
    () => new Set(selectedMemberIds),
    [selectedMemberIds]
  );
  const selectedMembers = members.filter(
    (c) => c.eligible && selectedSet.has(c.memberId)
  );
  const eligibleMembers = members.filter((m) => m.eligible);
  const eligibleCount = eligibleMembers.length;
  const allEligibleSelected =
    eligibleCount > 0 &&
    eligibleMembers.every((m) => selectedSet.has(m.memberId));
  const selectedTotal = selectedMembers.reduce((sum, m) => sum + m.owesTotal, 0);
  const selectedCurrency = selectedMembers[0]?.currency ?? "PHP";

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
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
  }, [onClose, busy]);

  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-to-pal-title"
      className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        aria-label="Close dialog"
        disabled={busy}
        onClick={onClose}
      />
      <div
        className="relative z-[1] flex max-h-[min(88dvh,28rem)] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl sm:rounded-2xl"
        style={{ marginBottom: "max(0px, env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 id="move-to-pal-title" className="text-base font-semibold">
              Move to Pal owes me
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Select members from {groupName}. They will no longer owe in this
              group.
            </p>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-10 w-10 shrink-0"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          {eligibleCount === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-muted-foreground">
              No members can be moved right now. They need an open balance, a
              Paypals account, and must not already be paid or moved.
            </p>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {selectedMembers.length > 0
                    ? `${selectedMembers.length} selected`
                    : "Select members"}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={busy}
                  onClick={
                    allEligibleSelected ? onClearSelection : onSelectAllEligible
                  }
                >
                  {allEligibleSelected ? "Clear all" : "Select all eligible"}
                </Button>
              </div>
              <ul className="space-y-1.5">
                {members.map((c) => {
                  const selectedRow =
                    c.eligible && selectedSet.has(c.memberId);
                  return (
                    <li key={c.memberId}>
                      <button
                        type="button"
                        disabled={busy || !c.eligible}
                        onClick={() => {
                          if (c.eligible) onToggleMember(c.memberId);
                        }}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
                          !c.eligible &&
                            "cursor-not-allowed border-border/60 bg-muted/10 opacity-70",
                          c.eligible &&
                            selectedRow &&
                            "border-primary bg-primary/10",
                          c.eligible &&
                            !selectedRow &&
                            "border-border bg-muted/20 hover:bg-muted/40"
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors",
                            !c.eligible && "border-border/60 bg-muted/20",
                            c.eligible &&
                              selectedRow &&
                              "border-primary bg-primary text-primary-foreground",
                            c.eligible &&
                              !selectedRow &&
                              "border-muted-foreground/40 bg-background"
                          )}
                          aria-hidden
                        >
                          {selectedRow ? (
                            <Check className="h-3 w-3" strokeWidth={3} />
                          ) : null}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{c.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {c.eligible
                              ? "Owes in this group"
                              : c.ineligibleReason}
                          </p>
                        </div>
                        {c.owesTotal > 0 ? (
                          <span className="shrink-0 text-sm font-semibold tabular-nums">
                            {money(c.owesTotal, c.currency)}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        <div className="space-y-2 border-t border-border px-4 py-3">
          {selectedMembers.length > 0 ? (
            <p className="text-center text-xs text-muted-foreground">
              {selectedMembers.length === 1 ? (
                <>
                  <span className="font-medium text-foreground">
                    {selectedMembers[0].name}
                  </span>
                  {" · "}
                  {money(selectedMembers[0].owesTotal, selectedMembers[0].currency)}{" "}
                  moves to Pal owes me
                </>
              ) : (
                <>
                  <span className="font-medium text-foreground">
                    {selectedMembers.length} members
                  </span>
                  {" · "}
                  {money(selectedTotal, selectedCurrency)} total moves to Pal owes
                  me
                </>
              )}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="flex-1"
              disabled={busy || selectedMembers.length === 0}
              onClick={onConfirm}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : selectedMembers.length <= 1 ? (
                "Move balance"
              ) : (
                `Move ${selectedMembers.length} balances`
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function MarkPaidConfirmModal({
  name,
  amountLabel,
  paid,
  busy,
  onConfirm,
  onClose,
}: {
  name: string;
  amountLabel: string;
  paid: boolean;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
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
  }, [onClose, busy]);

  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mark-paid-confirm-title"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        aria-label="Close dialog"
        disabled={busy}
        onClick={onClose}
      />
      <div
        className="relative z-[1] w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
        style={{ marginBottom: "max(0px, env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2
              id="mark-paid-confirm-title"
              className="text-base font-semibold"
            >
              {paid ? "Confirm payment" : "Mark as unpaid"}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {paid
                ? "This marks their balance as paid for this group."
                : "This clears their paid status for this group."}
            </p>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-10 w-10 shrink-0"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-center">
            <p className="text-sm font-medium">{name}</p>
            {paid ? (
              <>
                <p className="mt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Amount confirmed
                </p>
                <p className="text-2xl font-semibold tabular-nums tracking-tight">
                  {amountLabel}
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                Was marked paid for {amountLabel}
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="flex-1"
              variant={paid ? "default" : "secondary"}
              disabled={busy}
              onClick={onConfirm}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : paid ? (
                "Confirm paid"
              ) : (
                "Confirm unpaid"
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function DeleteGroupConfirmModal({
  groupName,
  busy,
  onConfirm,
  onClose,
}: {
  groupName: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
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
  }, [onClose, busy]);

  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-group-confirm-title"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        aria-label="Close dialog"
        disabled={busy}
        onClick={onClose}
      />
      <div
        className="relative z-[1] w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
        style={{ marginBottom: "max(0px, env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 id="delete-group-confirm-title" className="text-base font-semibold">
              Delete group?
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              This permanently removes the group and all related receipts and payments.
            </p>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-10 w-10 shrink-0"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-center">
            <p className="text-sm font-medium">{groupName}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              All members will lose access to this group.
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="flex-1"
              disabled={busy}
              onClick={onConfirm}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Delete group"
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
