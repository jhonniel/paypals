"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Loader2,
  UserPlus,
  Check,
  X,
  Search,
  Receipt,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

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
    avatar_url?: string | null;
  } | null;
  addressee: {
    id: string;
    full_name: string | null;
    username: string | null;
    email: string | null;
    avatar_url?: string | null;
  } | null;
};

type FriendBalanceRow = {
  friendship_id: string;
  user_id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  total_unpaid: number;
  currency: string;
  in_owned_group: boolean;
  groups: Array<{
    group_id: string;
    group_name: string;
    member_id: string;
    unpaid_total: number;
    currency: string;
    receipts: Array<{
      receipt_id: string;
      merchant: string | null;
      receipt_date: string | null;
      currency: string;
      amount: number;
      items: Array<{ name: string; quantity: number; amount: number }>;
    }>;
  }>;
};

type PersonHit = {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url?: string | null;
  email?: string | null;
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function money(value: number, currency = "PHP") {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatReceiptDate(value: string | null) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function FriendsPageView({ currentUserId }: { currentUserId: string }) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyUsername, setBusyUsername] = useState(false);
  const [unpaidModal, setUnpaidModal] = useState<FriendBalanceRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["friends"],
    queryFn: async () => {
      const res = await fetch("/api/friends");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed");
      return json.data as FriendRow[];
    },
  });

  const { data: balances, isLoading: balancesLoading } = useQuery({
    queryKey: ["friends-balances"],
    queryFn: async () => {
      const res = await fetch("/api/friends/balances");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed");
      return json.data as FriendBalanceRow[];
    },
  });

  const balanceByUserId = useMemo(() => {
    const map = new Map<string, FriendBalanceRow>();
    for (const row of balances ?? []) {
      map.set(row.user_id, row);
    }
    return map;
  }, [balances]);

  const searchQ = query.trim();
  const { data: suggestions, isFetching: searching } = useQuery({
    queryKey: ["friends-search", searchQ],
    enabled: searchQ.length >= 2,
    queryFn: async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(searchQ)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Search failed");
      return (json.data?.people ?? []) as PersonHit[];
    },
    staleTime: 15_000,
  });

  const relatedIds = useMemo(() => {
    const map = new Map<
      string,
      "accepted" | "pending_in" | "pending_out" | "blocked"
    >();
    for (const f of data ?? []) {
      const otherId =
        f.requester_id === currentUserId ? f.addressee_id : f.requester_id;
      if (f.status === "accepted") map.set(otherId, "accepted");
      else if (f.status === "blocked") map.set(otherId, "blocked");
      else if (f.status === "pending") {
        map.set(
          otherId,
          f.addressee_id === currentUserId ? "pending_in" : "pending_out"
        );
      }
    }
    return map;
  }, [data, currentUserId]);

  async function sendRequest(payload: { username?: string; user_id?: string }) {
    const key = payload.user_id ?? payload.username ?? "x";
    if (payload.user_id) setBusyId(payload.user_id);
    else setBusyUsername(true);
    try {
      const res = await fetch("/api/friends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed");
      toast.success("Friend request sent");
      setQuery("");
      await qc.invalidateQueries({ queryKey: ["friends"] });
      await qc.invalidateQueries({ queryKey: ["friends-search"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusyId(null);
      setBusyUsername(false);
      void key;
    }
  }

  async function onSubmitUsername(e: React.FormEvent) {
    e.preventDefault();
    const username = query.trim().replace(/^@/, "");
    if (username.length < 3) {
      toast.error("Enter at least 3 characters, or pick someone from the list");
      return;
    }
    await sendRequest({ username });
  }

  async function respond(id: string, status: "accepted" | "blocked") {
    const res = await fetch("/api/friends", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json?.error?.message ?? "Failed");
      return;
    }
    toast.success(status === "accepted" ? "Accepted" : "Blocked");
    await qc.invalidateQueries({ queryKey: ["friends"] });
    await qc.invalidateQueries({ queryKey: ["friends-balances"] });
  }

  const pending = (data ?? []).filter(
    (f) => f.status === "pending" && f.addressee_id === currentUserId
  );
  const accepted = (data ?? []).filter((f) => f.status === "accepted");
  const outgoing = (data ?? []).filter(
    (f) => f.status === "pending" && f.requester_id === currentUserId
  );

  function otherProfile(f: FriendRow) {
    return f.requester_id === currentUserId ? f.addressee : f.requester;
  }

  function otherName(f: FriendRow) {
    const p = otherProfile(f);
    return p?.full_name || p?.username || p?.email || "User";
  }

  function balanceForFriend(f: FriendRow): FriendBalanceRow | undefined {
    const p = otherProfile(f);
    if (!p?.id) return undefined;
    return balanceByUserId.get(p.id);
  }

  const people = suggestions ?? [];

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Friends
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search by name or username. Tap a friend in your group to see what
          they still owe.
        </p>
      </div>

      <Card>
        <CardContent className="p-4 sm:p-6">
          <form onSubmit={(e) => void onSubmitUsername(e)} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="uname">Find people</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="uname"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name or username…"
                  className="pl-9"
                  autoComplete="off"
                />
                {searching && (
                  <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                )}
              </div>
            </div>

            {searchQ.length >= 2 && (
              <div className="overflow-hidden rounded-xl border border-border bg-muted/20">
                {people.length === 0 && !searching ? (
                  <p className="px-4 py-3 text-sm text-muted-foreground">
                    No users match “{searchQ}”
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {people.map((p) => {
                      const label = p.full_name || p.username || "User";
                      const relation = relatedIds.get(p.id);
                      const busy = busyId === p.id;
                      return (
                        <li
                          key={p.id}
                          className="flex items-center justify-between gap-3 px-3 py-2.5 sm:px-4"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <Avatar className="h-9 w-9">
                              {p.avatar_url ? (
                                <AvatarImage src={p.avatar_url} alt="" />
                              ) : null}
                              <AvatarFallback>{initials(label)}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">
                                {label}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {p.username ? `@${p.username}` : "No username"}
                              </p>
                            </div>
                          </div>
                          {relation === "accepted" ? (
                            <span className="shrink-0 text-xs text-muted-foreground">
                              Friends
                            </span>
                          ) : relation === "pending_out" ? (
                            <span className="shrink-0 text-xs text-muted-foreground">
                              Request sent
                            </span>
                          ) : relation === "pending_in" ? (
                            <span className="shrink-0 text-xs text-muted-foreground">
                              Incoming
                            </span>
                          ) : relation === "blocked" ? (
                            <span className="shrink-0 text-xs text-muted-foreground">
                              Blocked
                            </span>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              disabled={busy}
                              onClick={() => void sendRequest({ user_id: p.id })}
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
            )}

            {searchQ.length > 0 && searchQ.length < 2 && (
              <p className="text-xs text-muted-foreground">
                Type at least 2 characters to see matching users.
              </p>
            )}

            <div className="flex justify-end">
              <Button
                type="submit"
                variant="outline"
                disabled={busyUsername || searchQ.length < 3}
              >
                {busyUsername ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <UserPlus />
                )}
                Send by exact username
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {isLoading && <Skeleton className="h-32 w-full" />}

      {pending.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Incoming</h2>
          {pending.map((f) => (
            <div
              key={f.id}
              className="glass flex items-center justify-between gap-3 rounded-2xl px-4 py-3"
            >
              <span className="text-sm font-medium">{otherName(f)}</span>
              <div className="flex gap-1">
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => void respond(f.id, "accepted")}
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => void respond(f.id, "blocked")}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </section>
      )}

      {outgoing.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Outgoing</h2>
          {outgoing.map((f) => (
            <div key={f.id} className="glass rounded-2xl px-4 py-3 text-sm">
              {otherName(f)}{" "}
              <span className="text-muted-foreground">· pending</span>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Friends</h2>
        {accepted.length === 0 && !isLoading && (
          <p className="text-sm text-muted-foreground">No friends yet.</p>
        )}
        {(isLoading || balancesLoading) && accepted.length > 0 && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {accepted.map((f) => (
              <Skeleton key={f.id} className="h-[6.25rem] rounded-2xl" />
            ))}
          </div>
        )}
        {!isLoading && !balancesLoading && accepted.length > 0 && (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {accepted.map((f) => {
              const profile = otherProfile(f);
              const label = otherName(f);
              const balance = balanceForFriend(f);
              const unpaid = balance?.total_unpaid ?? 0;
              const currency = balance?.currency ?? "PHP";
              const canViewUnpaid =
                Boolean(balance?.in_owned_group) && unpaid > 0;

              return (
                <li key={f.id}>
                  <button
                    type="button"
                    disabled={!canViewUnpaid}
                    onClick={() => {
                      if (balance && canViewUnpaid) setUnpaidModal(balance);
                    }}
                    className={cn(
                      "glass flex h-full min-h-[6.25rem] w-full flex-col gap-1.5 rounded-2xl p-2 text-left transition",
                      canViewUnpaid
                        ? "cursor-pointer hover:bg-muted/40 active:scale-[0.98]"
                        : "cursor-default"
                    )}
                  >
                    <div className="flex flex-col items-center gap-1.5 text-center">
                      <Avatar className="h-8 w-8 shrink-0">
                        {profile?.avatar_url ? (
                          <AvatarImage src={profile.avatar_url} alt="" />
                        ) : null}
                        <AvatarFallback className="text-[11px]">
                          {initials(label)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 w-full">
                        <p className="truncate text-xs font-medium leading-tight">
                          {label}
                        </p>
                        {profile?.username ? (
                          <p className="truncate text-[9px] text-muted-foreground">
                            @{profile.username}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    {canViewUnpaid ? (
                      <div className="mt-auto flex flex-col items-center justify-center rounded-lg bg-background/60 px-1.5 py-1.5 text-center">
                        <p className="text-[8px] font-medium uppercase tracking-wide text-muted-foreground">
                          Unpaid
                        </p>
                        <p className="w-full text-base font-bold tabular-nums leading-none tracking-tight text-amber-600 dark:text-amber-400 sm:text-lg">
                          {money(unpaid, currency)}
                        </p>
                      </div>
                    ) : balance?.in_owned_group ? (
                      <p className="mt-auto text-center text-[9px] text-muted-foreground">
                        Paid up
                      </p>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {unpaidModal && (
        <FriendUnpaidModal
          friend={unpaidModal}
          onClose={() => setUnpaidModal(null)}
        />
      )}
    </div>
  );
}

function FriendUnpaidModal({
  friend,
  onClose,
}: {
  friend: FriendBalanceRow;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const label = friend.full_name || friend.username || "Friend";

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

  const receiptCount = friend.groups.reduce(
    (n, g) => n + g.receipts.length,
    0
  );

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="friend-unpaid-title"
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div
        className="relative z-[1] flex max-h-[min(92dvh,40rem)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl sm:rounded-2xl"
        style={{ marginBottom: "max(0px, env(safe-area-inset-bottom))" }}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 id="friend-unpaid-title" className="text-base font-semibold">
              {label}
            </h2>
            <p className="text-xs text-muted-foreground">
              {money(friend.total_unpaid, friend.currency)} unpaid ·{" "}
              {receiptCount} transaction{receiptCount === 1 ? "" : "s"}
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
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          <div className="space-y-4">
            {friend.groups.map((group) => (
              <section key={group.group_id} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={`/groups/${group.group_id}`}
                    className="truncate text-sm font-medium hover:underline"
                    onClick={onClose}
                  >
                    {group.group_name}
                  </Link>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {money(group.unpaid_total, group.currency)}
                  </span>
                </div>

                <ul className="space-y-2">
                  {group.receipts.map((receipt) => (
                    <li
                      key={receipt.receipt_id}
                      className="overflow-hidden rounded-xl border border-border bg-muted/20"
                    >
                      <div className="flex items-start justify-between gap-2 border-b border-border/60 px-3 py-2">
                        <div className="flex min-w-0 items-start gap-2">
                          <Receipt className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {receipt.merchant || "Receipt"}
                            </p>
                            {receipt.receipt_date ? (
                              <p className="text-[11px] text-muted-foreground">
                                {formatReceiptDate(receipt.receipt_date)}
                              </p>
                            ) : null}
                          </div>
                        </div>
                        <span className="shrink-0 text-sm font-semibold tabular-nums">
                          {money(receipt.amount, receipt.currency)}
                        </span>
                      </div>
                      <ul className="divide-y divide-border/60 px-3">
                        {receipt.items.map((item, idx) => (
                          <li
                            key={`${receipt.receipt_id}-${idx}`}
                            className="flex items-center justify-between gap-2 py-2 text-sm"
                          >
                            <span className="min-w-0 truncate">
                              {item.name}
                              {item.quantity > 1 ? (
                                <span className="text-muted-foreground">
                                  {" "}
                                  ×{item.quantity}
                                </span>
                              ) : null}
                            </span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {money(item.amount, receipt.currency)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
