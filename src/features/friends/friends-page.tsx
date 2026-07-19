"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, UserPlus, Check, X, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

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

export function FriendsPageView({ currentUserId }: { currentUserId: string }) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyUsername, setBusyUsername] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["friends"],
    queryFn: async () => {
      const res = await fetch("/api/friends");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed");
      return json.data as FriendRow[];
    },
  });

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
    const map = new Map<string, "accepted" | "pending_in" | "pending_out" | "blocked">();
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
  }

  const pending = (data ?? []).filter(
    (f) => f.status === "pending" && f.addressee_id === currentUserId
  );
  const accepted = (data ?? []).filter((f) => f.status === "accepted");
  const outgoing = (data ?? []).filter(
    (f) => f.status === "pending" && f.requester_id === currentUserId
  );

  function other(f: FriendRow) {
    const p = f.requester_id === currentUserId ? f.addressee : f.requester;
    return p?.full_name || p?.username || p?.email || "User";
  }

  const people = suggestions ?? [];

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Friends</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search by name or username and send a friend request.
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
                              <p className="truncate text-sm font-medium">{label}</p>
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
              <Button type="submit" variant="outline" disabled={busyUsername || searchQ.length < 3}>
                {busyUsername ? <Loader2 className="animate-spin" /> : <UserPlus />}
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
              <span className="text-sm font-medium">{other(f)}</span>
              <div className="flex gap-1">
                <Button size="icon" variant="outline" onClick={() => void respond(f.id, "accepted")}>
                  <Check className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => void respond(f.id, "blocked")}>
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
              {other(f)} <span className="text-muted-foreground">· pending</span>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Friends</h2>
        {accepted.length === 0 && (
          <p className="text-sm text-muted-foreground">No friends yet.</p>
        )}
        {accepted.map((f) => (
          <div key={f.id} className="glass rounded-2xl px-4 py-3 text-sm font-medium">
            {other(f)}
          </div>
        ))}
      </section>
    </div>
  );
}
