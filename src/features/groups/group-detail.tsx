"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft,
  Copy,
  Loader2,
  Mail,
  UserPlus,
  Trash2,
  Receipt,
  ArrowRight,
  X,
  ZoomIn,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useGroupRealtime } from "@/hooks/use-realtime";
import { publicEnv } from "@/lib/env";
import { GroupClaimGate } from "@/features/groups/group-claim-gate";

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
  }>;
};

type GroupDetail = {
  group: {
    id: string;
    name: string;
    description: string | null;
    invite_code: string;
    created_by: string;
  };
  members: Member[];
  receipts: GroupReceipt[];
  pending_claim_receipts?: GroupReceipt[];
  must_claim_before_view?: boolean;
  my_role: string | null;
  my_member_id?: string | null;
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

function GroupReceiptCard({ receipt: r }: { receipt: GroupReceipt }) {
  const [expanded, setExpanded] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [imageBroken, setImageBroken] = useState(false);
  const currency = r.currency || "PHP";
  const visible = expanded ? r.items : r.items.slice(0, PREVIEW_ITEMS);
  const hiddenCount = Math.max(0, r.items.length - PREVIEW_ITEMS);
  const when = formatReceiptWhen(r.receipt_date, r.receipt_time);
  const showImage = Boolean(r.image_url) && !imageBroken;

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
              </p>
            </div>
          </div>
        </div>
      </div>

      {r.items.length > 0 ? (
        <div className="mt-3 max-w-lg">
          <ul className="space-y-1">
            {visible.map((item) => (
              <li
                key={item.id}
                className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-2 text-sm"
              >
                <span className="truncate font-medium">
                  {titleCaseItem(item.name)}
                </span>
                <span className="tabular-nums text-xs text-muted-foreground">
                  {item.quantity !== 1 ? `×${item.quantity}` : ""}
                </span>
                <span className="min-w-[4.75rem] text-right tabular-nums text-muted-foreground">
                  {money(item.total_price, currency)}
                </span>
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
          <dt>Subtotal</dt>
          <dd className="tabular-nums text-right sm:text-left">
            {money(Number(r.subtotal), currency)}
          </dd>
          {Number(r.tax) > 0 && (
            <>
              <dt>Tax</dt>
              <dd className="tabular-nums text-right sm:text-left">
                {money(Number(r.tax), currency)}
              </dd>
            </>
          )}
          {Number(r.discount) > 0 && (
            <>
              <dt>Discount</dt>
              <dd className="tabular-nums text-right sm:text-left">
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
        </dl>

        <Button variant="outline" size="sm" asChild className="h-8">
          <Link href={`/receipts/${r.id}#split`}>
            Pick what you got <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
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
  requester: { id: string; full_name: string | null; username: string | null } | null;
  addressee: { id: string; full_name: string | null; username: string | null } | null;
};

export function GroupDetailView({
  groupId,
  currentUserId,
}: {
  groupId: string;
  currentUserId: string;
}) {
  const qc = useQueryClient();
  useGroupRealtime(groupId, () => {
    void qc.invalidateQueries({ queryKey: ["group", groupId] });
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["group", groupId],
    queryFn: async () => {
      const res = await fetch(`/api/groups/${groupId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load");
      return json.data as GroupDetail;
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
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);

  const canManage = data?.my_role === "owner" || data?.my_role === "admin";
  const isCreator =
    data?.group.created_by === currentUserId || data?.my_role === "owner";
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
        name: other.full_name || other.username || "Friend",
      };
    })
    .filter((f): f is { id: string; name: string } => Boolean(f));

  async function copyInvite() {
    if (!data) return;
    await navigator.clipboard.writeText(data.invite_url);
    toast.success("Invite link copied");
  }

  async function copyGuestLink(token: string) {
    const url = `${publicEnv.appUrl}/invite/guest/${token}`;
    await navigator.clipboard.writeText(url);
    toast.success("Guest invite link copied");
  }

  async function emailGuest(email: string, token: string, name: string) {
    const url = `${publicEnv.appUrl}/invite/guest/${token}`;
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
          guest_email: guestEmail,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed");
      toast.success("Guest added — copy their invite link below");
      setGuestName("");
      setGuestEmail("");
      setInviteModalOpen(false);
      await qc.invalidateQueries({ queryKey: ["group", groupId] });
      if (json.data?.invite_token) {
        const url = `${publicEnv.appUrl}/invite/guest/${json.data.invite_token}`;
        await navigator.clipboard.writeText(url).catch(() => null);
        toast.message("Guest invite link copied");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function addByUsername(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "username", username }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed");
      toast.success("Member added");
      setUsername("");
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
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {data.group.name}
        </h1>
        {data.group.description && (
          <p className="mt-1 text-sm text-muted-foreground">{data.group.description}</p>
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-2 space-y-0 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">Receipts ({data.receipts?.length ?? 0})</CardTitle>
            <CardDescription>
              {isCreator
                ? "Upload receipts for the group — members tap what they ordered"
                : "Open a receipt and tap what you got"}
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
              <GroupReceiptCard key={r.id} receipt={r} />
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 p-4 sm:p-6">
          <div className="min-w-0">
            <CardTitle className="text-base">Members ({data.members.length})</CardTitle>
            <CardDescription>
              Guests stay on the bill until they claim their invite
            </CardDescription>
          </div>
          <Button
            type="button"
            size="sm"
            className="shrink-0"
            onClick={() => setInviteModalOpen(true)}
          >
            <UserPlus className="h-3.5 w-3.5" />
            Invite
          </Button>
        </CardHeader>
        <CardContent className="space-y-2 p-4 pt-0">
          {data.members.map((m) => {
            const label =
              m.profiles?.full_name ||
              m.profiles?.username ||
              m.guest_name ||
              m.guest_email ||
              "Member";
            const isGuest = Boolean(m.guest_email && !m.user_id);
            return (
              <div
                key={m.id}
                className="flex flex-col gap-2 rounded-xl bg-muted/40 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{label}</p>
                  <p className="text-xs capitalize text-muted-foreground">
                    {m.role}
                    {isGuest ? " · waiting to claim" : ""}
                    {m.guest_email && m.user_id ? " · claimed guest" : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {canManage && isGuest && m.invite_token && (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void copyGuestLink(m.invite_token!)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Link
                      </Button>
                      {m.guest_email && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            emailGuest(
                              m.guest_email!,
                              m.invite_token!,
                              m.guest_name || "there"
                            )
                          }
                        >
                          <Mail className="h-3.5 w-3.5" />
                          Email
                        </Button>
                      )}
                    </>
                  )}
                  {canManage && m.role !== "owner" && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label="Remove"
                      onClick={() => void removeMember(m.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {inviteModalOpen && (
        <InviteMembersModal
          busy={busy}
          canManage={Boolean(canManage)}
          inviteUrl={data.invite_url}
          inviteCode={data.group.invite_code}
          friends={acceptedFriends}
          username={username}
          guestName={guestName}
          guestEmail={guestEmail}
          onCopyInvite={() => void copyInvite()}
          onUsernameChange={setUsername}
          onGuestNameChange={setGuestName}
          onGuestEmailChange={setGuestEmail}
          onAddFriend={(id) => void addFriend(id)}
          onAddUsername={(e) => void addByUsername(e)}
          onAddGuest={(e) => void addGuest(e)}
          onClose={() => setInviteModalOpen(false)}
        />
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
  username,
  guestName,
  guestEmail,
  onCopyInvite,
  onUsernameChange,
  onGuestNameChange,
  onGuestEmailChange,
  onAddFriend,
  onAddUsername,
  onAddGuest,
  onClose,
}: {
  busy: boolean;
  canManage: boolean;
  inviteUrl: string;
  inviteCode: string;
  friends: Array<{ id: string; name: string }>;
  username: string;
  guestName: string;
  guestEmail: string;
  onCopyInvite: () => void;
  onUsernameChange: (v: string) => void;
  onGuestNameChange: (v: string) => void;
  onGuestEmailChange: (v: string) => void;
  onAddFriend: (id: string) => void;
  onAddUsername: (e: React.FormEvent) => void;
  onAddGuest: (e: React.FormEvent) => void;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);

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
                    Share the link, QR, or code. Friends can open the link or go to
                    Groups → Join with code.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm">
                      Code:{" "}
                      <span className="font-mono font-medium">{inviteCode}</span>
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(inviteCode);
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
                    <div className="flex flex-wrap gap-2">
                      {friends.map((f) => (
                        <Button
                          key={f.id}
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => onAddFriend(f.id)}
                        >
                          <UserPlus className="h-3.5 w-3.5" />
                          {f.name}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                <form onSubmit={onAddUsername} className="space-y-2">
                  <Label htmlFor="add-username">Username</Label>
                  <div className="flex gap-2">
                    <Input
                      id="add-username"
                      value={username}
                      onChange={(e) => onUsernameChange(e.target.value)}
                      placeholder="alex"
                    />
                    <Button
                      type="submit"
                      disabled={busy || !username}
                      size="icon"
                      className="shrink-0"
                    >
                      {busy ? <Loader2 className="animate-spin" /> : <UserPlus />}
                    </Button>
                  </div>
                </form>

                <form onSubmit={onAddGuest} className="space-y-2">
                  <Label>Invite without an account</Label>
                  <Input
                    value={guestName}
                    onChange={(e) => onGuestNameChange(e.target.value)}
                    placeholder="Name"
                    required
                  />
                  <Input
                    type="email"
                    value={guestEmail}
                    onChange={(e) => onGuestEmailChange(e.target.value)}
                    placeholder="email@example.com"
                    required
                  />
                  <Button
                    type="submit"
                    disabled={busy}
                    className="w-full"
                    size="sm"
                  >
                    {busy ? <Loader2 className="animate-spin" /> : <UserPlus />}
                    Add & create invite
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    They get a personal link to claim their seat on the bill.
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
