"use client";

import { useState } from "react";
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
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useGroupRealtime } from "@/hooks/use-realtime";
import { publicEnv } from "@/lib/env";

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

type GroupDetail = {
  group: {
    id: string;
    name: string;
    description: string | null;
    invite_code: string;
  };
  members: Member[];
  my_role: string | null;
  invite_url: string;
};

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

  const canManage = data?.my_role === "owner" || data?.my_role === "admin";
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invite link</CardTitle>
            <CardDescription>
              Share with anyone who already has a Paypals account
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div className="rounded-2xl bg-white p-3">
              <QRCodeSVG value={data.invite_url} size={140} />
            </div>
            <div className="w-full space-y-3">
              <p className="break-all text-xs text-muted-foreground">{data.invite_url}</p>
              <p className="text-sm">
                Code:{" "}
                <span className="font-mono font-medium">{data.group.invite_code}</span>
              </p>
              <Button type="button" variant="outline" onClick={() => void copyInvite()}>
                <Copy /> Copy link
              </Button>
            </div>
          </CardContent>
        </Card>

        {canManage && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add people</CardTitle>
              <CardDescription>
                Tap a friend, invite a guest without an account, or search by username
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {acceptedFriends.length > 0 && (
                <div className="space-y-2">
                  <Label>Friends</Label>
                  <div className="flex flex-wrap gap-2">
                    {acceptedFriends.map((f) => (
                      <Button
                        key={f.id}
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void addFriend(f.id)}
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        {f.name}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              <form onSubmit={(e) => void addByUsername(e)} className="space-y-3">
                <Label>Username</Label>
                <div className="flex gap-2">
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="alex"
                  />
                  <Button type="submit" disabled={busy || !username}>
                    <UserPlus />
                  </Button>
                </div>
              </form>

              <form onSubmit={(e) => void addGuest(e)} className="space-y-3">
                <Label>Invite someone without an account</Label>
                <Input
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="Name"
                  required
                />
                <Input
                  type="email"
                  value={guestEmail}
                  onChange={(e) => setGuestEmail(e.target.value)}
                  placeholder="email@example.com"
                  required
                />
                <Button type="submit" disabled={busy} className="w-full sm:w-auto">
                  {busy ? <Loader2 className="animate-spin" /> : <UserPlus />}
                  Add & create invite
                </Button>
                <p className="text-xs text-muted-foreground">
                  They get a personal link to claim their seat, then can tap items they
                  ordered on the receipt.
                </p>
              </form>
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Members ({data.members.length})</CardTitle>
          <CardDescription>
            Guests stay on the bill until they claim their invite
          </CardDescription>
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
    </div>
  );
}
