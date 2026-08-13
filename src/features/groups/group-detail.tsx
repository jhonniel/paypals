"use client";

import { Fragment, useEffect, useState } from "react";
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
  RotateCw,
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
import { itemSplitPerPersonAmount } from "@/lib/splits";
import { GroupClaimGate } from "@/features/groups/group-claim-gate";
import { readApiJson } from "@/lib/api-client";
import {
  paymentMethodDisplayLabel,
  type PaymentMethod,
} from "@/lib/payment-methods";
import { cn } from "@/utils/cn";
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
      sub_items?: ReceiptSubItem[];
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

function GroupReceiptCard({
  receipt: r,
  onPickItems,
  showUnclaimed,
  groupMemberCount = 0,
}: {
  receipt: GroupReceipt;
  onPickItems?: () => void;
  showUnclaimed?: boolean;
  groupMemberCount?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [imageBroken, setImageBroken] = useState(false);
  const currency = r.currency || "PHP";
  const visible = expanded ? r.items : r.items.slice(0, PREVIEW_ITEMS);
  const hiddenCount = Math.max(0, r.items.length - PREVIEW_ITEMS);
  const when = formatReceiptWhen(r.receipt_date, r.receipt_time);
  const showImage = Boolean(r.image_url) && !imageBroken;
  const unclaimed = showUnclaimed ? getReceiptUnclaimedItems(r.items) : null;

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

      {r.items.length > 0 ? (
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
              const groupPerPerson =
                isGroupSplit && groupMemberCount > 0
                  ? itemSplitPerPersonAmount(
                      Number(item.total_price),
                      "among_group",
                      null,
                      groupMemberCount
                    )
                  : null;

              const ownerLine = showUnclaimed ? ownerItemClaimLine(item) : null;
              const claimLine = ownerLine
                ? ownerLine.line
                : isGroupSplit
                  ? groupMemberCount > 0 && groupPerPerson != null
                    ? `Split among ${groupMemberCount} · ${money(groupPerPerson, currency)}/each`
                    : "Split with whole group"
                  : claimLabel
                    ? othersN > 0
                      ? "You claimed this · others also claimed"
                      : `Claimed by ${claimLabel}`
                    : othersN > 0 || item.claimers_hidden
                      ? "Already claimed"
                      : "Not claimed yet";
              const claimUnclaimed = ownerLine?.unclaimed ?? false;

              return (
                <li key={item.id} className="text-sm">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-2">
                    <span className="truncate font-medium">
                      {titleCaseItem(item.name)}
                    </span>
                    <span className="tabular-nums text-xs text-muted-foreground">
                      {item.quantity !== 1 ? `×${item.quantity}` : ""}
                    </span>
                    <span className="min-w-[4.75rem] text-right tabular-nums text-muted-foreground">
                      {money(item.total_price, currency)}
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
          {(r.discounts?.length ? r.discounts : Number(r.discount) > 0 ? [{ label: "Discount", amount: Number(r.discount) }] : []).map(
            (d) => (
              <Fragment key={`${d.label}-${d.amount}`}>
                <dt>{d.label}</dt>
                <dd className="tabular-nums text-right sm:text-left">
                  −{money(Number(d.amount), currency)}
                </dd>
              </Fragment>
            )
          )}
          {Number(r.discount) > 0 && (r.discounts?.length ?? 0) > 1 && (
            <>
              <dt className="font-medium text-foreground">Total discounts</dt>
              <dd className="font-medium tabular-nums text-right text-foreground sm:text-left">
                −{money(Number(r.discount), currency)}
              </dd>
            </>
          )}
          {Number(r.service_charge) > 0 && (
            <>
              <dt>Service</dt>
              <dd className="tabular-nums text-right sm:text-left">
                {money(Number(r.service_charge), currency)}
              </dd>
            </>
          )}
          {Number(r.tip) > 0 && (
            <>
              <dt>Tip</dt>
              <dd className="tabular-nums text-right sm:text-left">
                {money(Number(r.tip), currency)}
              </dd>
            </>
          )}
          <dt className="font-medium text-foreground">Amount due</dt>
          <dd className="font-semibold tabular-nums text-right text-foreground sm:text-left">
            {money(Number(r.total), currency)}
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
  });

  const { data: friends } = useQuery({
    queryKey: ["friends"],
    queryFn: async () => {
      const res = await fetch("/api/friends");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed");
      return json.data as FriendRow[];
    },
  });

  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [claimReceiptId, setClaimReceiptId] = useState<string | null>(null);
  const [claimForMember, setClaimForMember] = useState<{
    memberId: string;
    name: string;
  } | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null);
  const [markPaidConfirm, setMarkPaidConfirm] = useState<{
    memberId: string;
    name: string;
    amountLabel: string;
    paid: boolean;
  } | null>(null);
  const [flippedMembers, setFlippedMembers] = useState<Set<string>>(new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState(false);

  function toggleMemberFlip(memberId: string) {
    setFlippedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  const canManage =
    data?.my_role === "owner" ||
    data?.my_role === "admin" ||
    data?.group.created_by === currentUserId;
  const isCreator =
    data?.group.created_by === currentUserId || data?.my_role === "owner";
  const isOwner = data?.my_role === "owner";
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

  async function addGuest(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "guest",
          guest_name: guestName,
          ...(guestEmail.trim() ? { guest_email: guestEmail.trim() } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed");
      toast.success("Member added — they’ll pick this name when they join");
      setGuestName("");
      setGuestEmail("");
      setInviteModalOpen(false);
      await qc.invalidateQueries({ queryKey: ["group", groupId] });
      if (json.data?.invite_token && guestEmail.trim()) {
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
    if (!confirm("Remove this member from the group?")) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/groups/${groupId}/members?member_id=${memberId}`,
        { method: "DELETE" }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed");
      toast.success("Removed");
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
      const form = new FormData();
      form.append("file", file);
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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setMarkingPaidId(null);
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
        memberCount={data.members.length}
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
                "Upload receipts for the group — members tap what they ordered"
              ) : (
                "Open a receipt and tap what you got"
              )}
            </CardDescription>
          </div>
          {isCreator && (
            <Button variant="outline" size="sm" asChild className="self-start sm:self-auto">
              <Link href={`/receipts/new?group=${groupId}`}>
                <Receipt className="h-3.5 w-3.5" />
                Add receipt
              </Link>
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          {(data.receipts?.length ?? 0) === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                {isCreator
                  ? "No receipts yet. Upload one so members can pick what they got."
                  : "No receipts yet. Only the group creator can upload — check back soon."}
              </p>
              {isCreator && (
                <Button className="mt-4" variant="outline" asChild>
                  <Link href={`/receipts/new?group=${groupId}`}>Upload a receipt</Link>
                </Button>
              )}
            </div>
          ) : (
            data.receipts.map((r) => (
              <GroupReceiptCard
                key={r.id}
                receipt={r}
                groupMemberCount={data.member_count ?? data.members.length}
                showUnclaimed={canManage}
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
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.members.map((m) => {
              const label =
                m.profiles?.full_name ||
                m.profiles?.username ||
                m.guest_name ||
                m.guest_email ||
                "Member";
              const isGuest = Boolean(m.guest_name && !m.user_id);
              const isMe = m.id === data.my_member_id;
              const isOwnerSeat = m.role === "owner";
              const pay = data.member_payments?.find((p) => p.member_id === m.id);
              const payTotal = pay?.total ?? 0;
              const owesTotal = pay?.owes ?? payTotal;
              const isBillPayer = pay?.is_bill_payer ?? false;
              const payCurrency = pay?.currency ?? "PHP";
              const items = pay?.items ?? [];
              const initial = label.trim().charAt(0).toUpperCase() || "?";
              const proof = data.payment_proofs?.find((p) => p.member_id === m.id);
              const proofMeta = {
                manual: Boolean(proof?.manual),
                bill_payer: Boolean(proof?.bill_payer),
              };
              const isPaid =
                proof?.status === "paid" &&
                (isBillPayer && owesTotal <= 0
                  ? proofMeta.bill_payer || proofMeta.manual
                  : owesTotal > 0 &&
                    (proofMeta.manual ||
                      Math.abs((proof.expected_amount ?? 0) - owesTotal) <= 1));
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
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-4 w-4" />
                          Paid
                          {proof?.manual ? (
                            <span className="font-normal opacity-80">· manual</span>
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
                          accept="image/png,image/jpeg,image/webp,image/gif"
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
                      <div className="mt-2 flex gap-1.5">
                        {owesTotal > 0 && (
                          <Button
                            type="button"
                            size="sm"
                            variant={isPaid ? "outline" : "secondary"}
                            className="h-8 min-w-0 flex-1 px-2 text-[11px]"
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
                            className="h-8 min-w-0 flex-1 px-2 text-[11px]"
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
                        onClick={() => void removeMember(m.id)}
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

      {inviteModalOpen && (
        <InviteMembersModal
          busy={busy}
          canManage={Boolean(canManage)}
          inviteUrl={data.invite_url}
          inviteCode={data.group.invite_code}
          friends={acceptedFriends}
          memberUserIds={memberUserIds}
          guestName={guestName}
          guestEmail={guestEmail}
          onCopyInvite={() => void copyInvite()}
          onGuestNameChange={setGuestName}
          onGuestEmailChange={setGuestEmail}
          onAddFriend={(id) => void addFriend(id)}
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
                  memberCount={data.members.length}
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
                memberCount={data.members.length}
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
  guestName,
  guestEmail,
  onCopyInvite,
  onGuestNameChange,
  onGuestEmailChange,
  onAddFriend,
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
  guestName: string;
  guestEmail: string;
  onCopyInvite: () => void;
  onGuestNameChange: (v: string) => void;
  onGuestEmailChange: (v: string) => void;
  onAddFriend: (id: string) => void;
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

  const people = (searchHits ?? []).filter((p) => !memberUserIds.has(p.id));

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
                      placeholder="Search name, username, or email…"
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
                            const label = p.full_name || p.username || p.email || "User";
                            const inGroup = memberUserIds.has(p.id);
                            return (
                              <li
                                key={p.id}
                                className="flex items-center justify-between gap-3 px-3 py-2.5"
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">{label}</p>
                                  <p className="truncate text-xs text-muted-foreground">
                                    {[
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
                                    onClick={() => onAddFriend(p.id)}
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
                    When they join with the group link, they pick this name, then
                    pick what they ordered.
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
