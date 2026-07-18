"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, UserPlus, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type FriendRow = {
  id: string;
  status: string;
  requester_id: string;
  addressee_id: string;
  requester: { id: string; full_name: string | null; username: string | null; email: string | null } | null;
  addressee: { id: string; full_name: string | null; username: string | null; email: string | null } | null;
};

export function FriendsPageView({ currentUserId }: { currentUserId: string }) {
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["friends"],
    queryFn: async () => {
      const res = await fetch("/api/friends");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed");
      return json.data as FriendRow[];
    },
  });

  async function sendRequest(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/friends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed");
      toast.success("Friend request sent");
      setUsername("");
      await qc.invalidateQueries({ queryKey: ["friends"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
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

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Friends</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search by username and share groups faster.
        </p>
      </div>

      <Card>
        <CardContent className="p-4 sm:p-6">
          <form onSubmit={sendRequest} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="uname">Add by username</Label>
              <Input
                id="uname"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="jordan"
                required
              />
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <UserPlus />}
              Send request
            </Button>
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
