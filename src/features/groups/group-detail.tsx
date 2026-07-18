"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft,
  Copy,
  Loader2,
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

type Member = {
  id: string;
  role: string;
  user_id: string | null;
  guest_name: string | null;
  guest_email: string | null;
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

export function GroupDetailView({ groupId }: { groupId: string }) {
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

  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);

  const canManage = data?.my_role === "owner" || data?.my_role === "admin";

  async function copyInvite() {
    if (!data) return;
    await navigator.clipboard.writeText(data.invite_url);
    toast.success("Invite link copied");
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
      toast.success("Guest added");
      setGuestName("");
      setGuestEmail("");
      await qc.invalidateQueries({ queryKey: ["group", groupId] });
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
            <CardTitle className="text-base">Invite</CardTitle>
            <CardDescription>Share link or QR — members join instantly</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div className="rounded-2xl bg-white p-3">
              <QRCodeSVG value={data.invite_url} size={140} />
            </div>
            <div className="w-full space-y-3">
              <p className="break-all text-xs text-muted-foreground">{data.invite_url}</p>
              <p className="text-sm">
                Code: <span className="font-mono font-medium">{data.group.invite_code}</span>
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
              <CardTitle className="text-base">Add members</CardTitle>
              <CardDescription>By username or as a guest</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <form onSubmit={addByUsername} className="space-y-3">
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
              <form onSubmit={addGuest} className="space-y-3">
                <Label>Guest</Label>
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
                  Add guest
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Members ({data.members.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 p-4 pt-0">
          {data.members.map((m) => {
            const label =
              m.profiles?.full_name ||
              m.profiles?.username ||
              m.guest_name ||
              m.guest_email ||
              "Member";
            return (
              <div
                key={m.id}
                className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{label}</p>
                  <p className="text-xs capitalize text-muted-foreground">
                    {m.role}
                    {m.guest_email ? " · guest" : ""}
                  </p>
                </div>
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
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
