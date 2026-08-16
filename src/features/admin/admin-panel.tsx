"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  Flag,
  Link2,
  Loader2,
  Pencil,
  Receipt,
  Shield,
  Trash2,
  TrendingUp,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPHP } from "@/lib/money";
import { signupInviteUrl } from "@/lib/signup-invite-url";
import { SIGNUP_INVITE_RETENTION_DAYS } from "@/lib/signup-invite-cleanup";
import { AdminAnnouncementsPanel } from "@/features/admin/admin-announcements";
import { formatDistanceToNow } from "date-fns";

type AdminData = {
  health: {
    database: boolean;
    serviceRole: boolean;
    ocrConfigured: boolean;
    ocrSuccessRate: number | null;
    appUrl: string | null;
  };
  counts: {
    users: number;
    receipts: number;
    groups: number;
    totalSpend: number;
    currency: string;
  };
  users: Array<{
    id: string;
    email: string | null;
    full_name: string | null;
    username: string | null;
    is_admin: boolean;
    created_at: string;
    totalSpent: number;
    receiptCount: number;
  }>;
  receipts: Array<{
    id: string;
    merchant: string | null;
    total: number;
    status: string;
    currency: string;
    created_at: string;
    ocr_confidence: number | null;
  }>;
  ocrLogs: Array<{
    id: string;
    provider: string;
    status: string;
    confidence: number | null;
    duration_ms: number | null;
    error_message: string | null;
    created_at: string;
    receipt_id: string;
  }>;
  featureFlags: Array<{
    key: string;
    enabled: boolean;
    description: string | null;
  }>;
  auditLogs: Array<{
    id: string;
    action: string;
    entity_type: string;
    entity_id: string | null;
    created_at: string;
    actor_id: string | null;
  }>;
};

export function AdminPanelView({ currentUserId }: { currentUserId: string }) {
  const qc = useQueryClient();
  const [newKey, setNewKey] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [inviteLabel, setInviteLabel] = useState("");
  const [inviteMaxUses, setInviteMaxUses] = useState(10);
  const [inviteSendTo, setInviteSendTo] = useState("");
  const [lastCreatedCode, setLastCreatedCode] = useState<string | null>(null);
  const [lastCreatedCodes, setLastCreatedCodes] = useState<string[]>([]);
  const [lastCreatedUrls, setLastCreatedUrls] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [renamingUserId, setRenamingUserId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin"],
    queryFn: async () => {
      const res = await fetch("/api/admin");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Admin access denied");
      return json.data as AdminData;
    },
  });

  const { data: signupInvites, refetch: refetchInvites } = useQuery({
    queryKey: ["admin-invites"],
    queryFn: async () => {
      const res = await fetch("/api/admin/invites");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load invites");
      return json.data as Array<{
        id: string;
        code: string;
        label: string | null;
        max_uses: number | null;
        use_count: number;
        enabled: boolean;
        expires_at: string | null;
        updated_at: string;
        invite_url?: string;
      }>;
    },
    enabled: !isLoading && !error,
  });

  async function renameUser(user: AdminData["users"][number]) {
    const current = user.full_name || user.username || user.email || "";
    const next = window.prompt("Display name", current)?.trim();
    if (!next || next === current) return;

    setRenamingUserId(user.id);
    void qc.setQueryData<AdminData>(["admin"], (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        users: prev.users.map((u) =>
          u.id === user.id ? { ...u, full_name: next } : u
        ),
      };
    });
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Rename failed");
      toast.success("Name updated");
      await qc.invalidateQueries({ queryKey: ["admin"] });
    } catch (err) {
      await qc.invalidateQueries({ queryKey: ["admin"] });
      toast.error(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setRenamingUserId(null);
    }
  }

  async function deleteUser(user: AdminData["users"][number]) {
    const label = user.full_name || user.username || user.email || "this user";
    if (
      !confirm(
        `Permanently delete ${label}? Their receipts, owned groups, and account data will be removed. This cannot be undone.`
      )
    ) {
      return;
    }

    setDeletingUserId(user.id);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Delete failed");
      toast.success("User deleted");
      await qc.invalidateQueries({ queryKey: ["admin"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingUserId(null);
    }
  }

  async function toggleAdmin(userId: string, is_admin: boolean) {
    setBusy(true);
    // Optimistic UI so the switch moves immediately
    void qc.setQueryData<AdminData>(["admin"], (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        users: prev.users.map((u) =>
          u.id === userId ? { ...u, is_admin } : u
        ),
      };
    });
    try {
      const res = await fetch("/api/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, is_admin }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Update failed");
      toast.success(is_admin ? "Granted admin" : "Removed admin");
      await qc.invalidateQueries({ queryKey: ["admin"] });
    } catch (err) {
      await qc.invalidateQueries({ queryKey: ["admin"] });
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleFlag(key: string, enabled: boolean) {
    setBusy(true);
    try {
      const res = await fetch("/api/feature-flags", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, enabled }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Flag update failed");
      toast.success(`Flag ${key} ${enabled ? "on" : "off"}`);
      void qc.invalidateQueries({ queryKey: ["admin"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function createFlag(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/feature-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: newKey.trim(),
          enabled: false,
          description: newDesc.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Create failed");
      toast.success("Flag created");
      setNewKey("");
      setNewDesc("");
      void qc.invalidateQueries({ queryKey: ["admin"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function createSignupInvite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const maxUses = Math.min(1000, Math.max(1, Math.floor(inviteMaxUses) || 10));
      const res = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: inviteLabel.trim() || null,
          max_uses: maxUses,
          ...(inviteSendTo.trim()
            ? { send_to: inviteSendTo.trim() }
            : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Create failed");

      const code = (json.data?.code as string | undefined) ?? null;
      const url =
        (json.data?.invite_url as string | undefined) ??
        (code ? signupInviteUrl(code) : null);

      setLastCreatedCodes(code ? [code] : []);
      setLastCreatedUrls(url ? [url] : []);
      setLastCreatedCode(code);
      setInviteLabel("");
      setInviteSendTo("");
      if (url) {
        await navigator.clipboard.writeText(url).catch(() => null);
      }

      const emailed = json.data?.emailed as
        | { sent?: boolean; error?: string }
        | null
        | undefined;
      if (emailed?.sent) {
        toast.success(`Invite link created (${maxUses} signups) and emailed`);
      } else if (emailed && emailed.sent === false) {
        toast.success(
          `Invite link created (email failed: ${emailed.error ?? "SMTP"})`
        );
      } else {
        toast.success(`Invite link created — up to ${maxUses} signups (copied)`);
      }
      void refetchInvites();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleInvite(id: string, enabled: boolean) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/invites", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, enabled }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Update failed");
      toast.success(enabled ? "Invite enabled" : "Invite disabled");
      void refetchInvites();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function deleteInvite(inv: {
    id: string;
    code: string;
    label: string | null;
  }) {
    const label = inv.label || inv.code;
    if (!confirm(`Remove invite “${label}”? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/invites", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: inv.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Delete failed");
      toast.success("Invite removed");
      void refetchInvites();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Admin access required</CardTitle>
          <CardDescription>
            {error instanceof Error
              ? error.message
              : "Sign in as an admin user (e.g. casey@example.com)."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          <Shield className="h-6 w-6 text-primary" />
          Admin
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Users, receipts, OCR health, feature flags, and audit trail.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Users", value: String(data.counts.users), icon: Users },
          { label: "Receipts", value: String(data.counts.receipts), icon: Receipt },
          { label: "Groups", value: String(data.counts.groups), icon: Activity },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="space-y-1 p-3 sm:p-4">
              <div className="flex items-center gap-1.5">
                <s.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <p className="truncate text-[11px] text-muted-foreground sm:text-xs">
                  {s.label}
                </p>
              </div>
              <p className="truncate text-lg font-semibold tabular-nums sm:text-xl">
                {s.value}
              </p>
            </CardContent>
          </Card>
        ))}
        <Card className="col-span-3">
          <CardContent className="space-y-1 p-4">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Total receipt spend</p>
            </div>
            <p className="truncate text-xl font-semibold tabular-nums">
              {formatPHP(
                data.counts.totalSpend ?? 0,
                data.counts.currency ?? "PHP"
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>System health</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
          <HealthPill label="Database" ok={data.health.database} />
          <HealthPill label="Service role" ok={data.health.serviceRole} />
          <HealthPill label="OCR keys" ok={data.health.ocrConfigured} />
          <div className="rounded-xl border border-border px-3 py-2">
            <p className="text-xs text-muted-foreground">OCR success (last 100)</p>
            <p className="font-semibold tabular-nums">
              {data.health.ocrSuccessRate != null ? `${data.health.ocrSuccessRate}%` : "—"}
            </p>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="users">
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList className="inline-flex h-auto min-w-max">
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="invites">Invites</TabsTrigger>
            <TabsTrigger value="receipts">Receipts</TabsTrigger>
            <TabsTrigger value="ocr">OCR logs</TabsTrigger>
            <TabsTrigger value="announcements">Announcements</TabsTrigger>
            <TabsTrigger value="flags">Feature flags</TabsTrigger>
            <TabsTrigger value="audit">Audit</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="users" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Users</CardTitle>
              <CardDescription>
                Spent is the sum of receipt totals each user uploaded.
              </CardDescription>
            </CardHeader>
            <CardContent className="divide-y divide-border p-0">
              {data.users.map((u) => (
                <div
                  key={u.id}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <p className="truncate text-sm font-medium">
                        {u.full_name || u.username || u.email}
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0"
                        disabled={busy || renamingUserId !== null || deletingUserId !== null}
                        aria-label={`Rename ${u.full_name || u.username || u.email || "user"}`}
                        onClick={() => void renameUser(u)}
                      >
                        {renamingUserId === u.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Pencil className="size-3.5" />
                        )}
                      </Button>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                    <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                      {formatPHP(u.totalSpent ?? 0)} · {u.receiptCount ?? 0} receipt
                      {(u.receiptCount ?? 0) === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs text-muted-foreground">Admin</span>
                    <Switch
                      checked={u.is_admin}
                      disabled={busy || deletingUserId === u.id}
                      onCheckedChange={(v) => void toggleAdmin(u.id, v)}
                    />
                    {u.id !== currentUserId ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:text-destructive"
                        disabled={busy || deletingUserId !== null}
                        aria-label={`Delete ${u.full_name || u.username || u.email || "user"}`}
                        onClick={() => void deleteUser(u)}
                      >
                        {deletingUserId === u.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invites" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Signup invites</CardTitle>
              <CardDescription>
                One shareable link per invite with a signup limit. Fully used links are
                removed automatically {SIGNUP_INVITE_RETENTION_DAYS} days after the last
                signup. Group invites are separate.
              </CardDescription>
            </CardHeader>
            <CardContent className="divide-y divide-border p-0">
              {(signupInvites ?? []).length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No invites yet.</p>
              ) : (
                (signupInvites ?? []).map((inv) => {
                  const maxUses = inv.max_uses ?? null;
                  const exhausted =
                    maxUses != null && inv.use_count >= maxUses;
                  const used = exhausted || !inv.enabled;
                  const url = inv.invite_url || signupInviteUrl(inv.code);
                  const usageLabel =
                    maxUses == null
                      ? `${inv.use_count} signups · no limit`
                      : exhausted
                        ? `${inv.use_count} / ${maxUses} signups · full`
                        : `${inv.use_count} / ${maxUses} signups used`;
                  const autoRemoveHint =
                    exhausted && inv.updated_at
                      ? ` · auto-removes ${SIGNUP_INVITE_RETENTION_DAYS}d after last use`
                      : "";
                  return (
                    <div
                      key={inv.id}
                      className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-semibold tracking-wide">
                          {inv.code}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {url}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {inv.label || "Untitled"} · {usageLabel}
                          {autoRemoveHint}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                        <Button
                          type="button"
                          size="sm"
                          variant="default"
                          disabled={used}
                          onClick={() => {
                            void navigator.clipboard.writeText(url).then(
                              () => toast.success("Invite link copied"),
                              () => toast.error("Could not copy")
                            );
                          }}
                        >
                          <Link2 className="h-3.5 w-3.5" />
                          Copy link
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            void navigator.clipboard.writeText(inv.code).then(
                              () => toast.success("Code copied"),
                              () => toast.error("Could not copy")
                            );
                          }}
                        >
                          Copy code
                        </Button>
                        <span className="text-xs text-muted-foreground">Enabled</span>
                        <Switch
                          checked={inv.enabled}
                          disabled={busy || exhausted}
                          onCheckedChange={(v) => void toggleInvite(inv.id, v)}
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-8 text-destructive hover:text-destructive"
                          disabled={busy}
                          aria-label={`Remove invite ${inv.code}`}
                          onClick={() => void deleteInvite(inv)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Create signup invite</CardTitle>
              <CardDescription>
                Generate one invite link. Choose how many people can sign up with it
                before it stops working.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={(e) => void createSignupInvite(e)} className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="invite-label">Label (optional)</Label>
                    <Input
                      id="invite-label"
                      value={inviteLabel}
                      onChange={(e) => setInviteLabel(e.target.value)}
                      placeholder="e.g. Dinner group batch"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="invite-max-uses">Signup limit</Label>
                    <Input
                      id="invite-max-uses"
                      type="number"
                      min={1}
                      max={1000}
                      value={inviteMaxUses}
                      onChange={(e) =>
                        setInviteMaxUses(Number(e.target.value) || 10)
                      }
                    />
                    <p className="text-[11px] text-muted-foreground">
                      One link — up to this many people can create accounts
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-send-to">Email link(s) to (optional)</Label>
                  <Input
                    id="invite-send-to"
                    type="email"
                    value={inviteSendTo}
                    onChange={(e) => setInviteSendTo(e.target.value)}
                    placeholder="friend@email.com"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Requires SMTP env vars. Sends the invite link so they can sign up.
                  </p>
                </div>
                {lastCreatedUrls[0] || lastCreatedCode ? (
                  <div className="space-y-1.5 rounded-lg bg-muted/50 px-3 py-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      Last created link
                    </p>
                    <p className="break-all font-mono text-xs font-semibold">
                      {lastCreatedUrls[0] || signupInviteUrl(lastCreatedCode!)}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const url =
                          lastCreatedUrls[0] ||
                          signupInviteUrl(lastCreatedCode!);
                        void navigator.clipboard.writeText(url).then(
                          () => toast.success("Invite link copied"),
                          () => toast.error("Could not copy")
                        );
                      }}
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      Copy link
                    </Button>
                  </div>
                ) : null}
                <Button type="submit" disabled={busy}>
                  {busy && <Loader2 className="animate-spin" />}
                  Generate invite link
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="receipts" className="mt-4">
          <Card>
            <CardContent className="divide-y divide-border p-0">
              {data.receipts.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {r.merchant || "Untitled"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.status} · {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums">
                    {formatPHP(r.total, r.currency)}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ocr" className="mt-4">
          <Card>
            <CardContent className="divide-y divide-border p-0">
              {data.ocrLogs.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No OCR logs yet.</p>
              ) : (
                data.ocrLogs.map((log) => (
                  <div key={log.id} className="px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">
                        {log.provider} · {log.status}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {log.duration_ms != null ? `${log.duration_ms}ms` : "—"}
                        {log.confidence != null ? ` · ${log.confidence}%` : ""}
                      </p>
                    </div>
                    {log.error_message && (
                      <p className="mt-1 text-xs text-destructive">{log.error_message}</p>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="announcements" className="mt-4">
          <AdminAnnouncementsPanel />
        </TabsContent>

        <TabsContent value="flags" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Flag className="h-4 w-4" /> Flags
              </CardTitle>
              <CardDescription>Toggle product capabilities without redeploying.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.featureFlags.map((f) => (
                <div key={f.key} className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">{f.key}</p>
                    {f.description && (
                      <p className="text-xs text-muted-foreground">{f.description}</p>
                    )}
                  </div>
                  <Switch
                    checked={f.enabled}
                    disabled={busy}
                    onCheckedChange={(v) => void toggleFlag(f.key, v)}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add flag</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={(e) => void createFlag(e)} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="flag-key">Key</Label>
                  <Input
                    id="flag-key"
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    placeholder="my_feature"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="flag-desc">Description</Label>
                  <Input
                    id="flag-desc"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="Optional"
                  />
                </div>
                <Button type="submit" disabled={busy || !newKey.trim()}>
                  {busy && <Loader2 className="animate-spin" />}
                  Create
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <Card>
            <CardContent className="divide-y divide-border p-0">
              {data.auditLogs.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No audit events yet.</p>
              ) : (
                data.auditLogs.map((a) => (
                  <div key={a.id} className="px-4 py-3 text-sm">
                    <p className="font-medium">
                      {a.action}{" "}
                      <span className="font-normal text-muted-foreground">
                        on {a.entity_type}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function HealthPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="rounded-xl border border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`font-semibold ${ok ? "text-primary" : "text-destructive"}`}>
        {ok ? "OK" : "Missing"}
      </p>
    </div>
  );
}
