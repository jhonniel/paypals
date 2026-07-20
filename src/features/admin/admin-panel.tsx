"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  Flag,
  Loader2,
  Receipt,
  Shield,
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

export function AdminPanelView() {
  const qc = useQueryClient();
  const [newKey, setNewKey] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [inviteLabel, setInviteLabel] = useState("");
  const [inviteCount, setInviteCount] = useState(1);
  const [inviteSendTo, setInviteSendTo] = useState("");
  const [lastCreatedCode, setLastCreatedCode] = useState<string | null>(null);
  const [lastCreatedCodes, setLastCreatedCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

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
      }>;
    },
    enabled: !isLoading && !error,
  });

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
      const count = Math.min(50, Math.max(1, Math.floor(inviteCount) || 1));
      const res = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: inviteLabel.trim() || null,
          count,
          ...(inviteSendTo.trim()
            ? { send_to: inviteSendTo.trim() }
            : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Create failed");

      const codes: string[] =
        Array.isArray(json.data?.codes)
          ? (json.data.codes as string[])
          : json.data?.code
            ? [json.data.code as string]
            : [];

      setLastCreatedCodes(codes);
      setLastCreatedCode(codes[0] ?? null);
      setInviteLabel("");
      setInviteSendTo("");
      if (codes.length) {
        await navigator.clipboard.writeText(codes.join("\n")).catch(() => null);
      }

      const emailed = json.data?.emailed as
        | { sent?: boolean; error?: string }
        | null
        | undefined;
      if (emailed?.sent) {
        toast.success(
          count === 1
            ? `Invite ${codes[0]} created and emailed`
            : `${codes.length} invites created and emailed`
        );
      } else if (emailed && emailed.sent === false) {
        toast.success(
          count === 1
            ? `Invite ${codes[0]} created (email failed: ${emailed.error ?? "SMTP"})`
            : `${codes.length} invites created (email failed)`
        );
      } else {
        toast.success(
          count === 1
            ? `Invite ${codes[0]} created (copied)`
            : `${codes.length} invites created (all codes copied)`
        );
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Users", value: String(data.counts.users), icon: Users },
          { label: "Receipts", value: String(data.counts.receipts), icon: Receipt },
          { label: "Groups", value: String(data.counts.groups), icon: Activity },
          {
            label: "Total receipt spend",
            value: formatPHP(
              data.counts.totalSpend ?? 0,
              data.counts.currency ?? "PHP"
            ),
            icon: TrendingUp,
          },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="flex items-center gap-3 p-4">
              <s.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="truncate text-xl font-semibold tabular-nums">
                  {s.value}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>System health</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
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
                    <p className="truncate text-sm font-medium">
                      {u.full_name || u.username || u.email}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                    <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                      {formatPHP(u.totalSpent ?? 0)} · {u.receiptCount ?? 0} receipt
                      {(u.receiptCount ?? 0) === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">Admin</span>
                    <Switch
                      checked={u.is_admin}
                      disabled={busy}
                      onCheckedChange={(v) => void toggleAdmin(u.id, v)}
                    />
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
                Each code is unique and works once. After someone signs up with it, it
                can’t be reused. Group invite codes are separate — they only join a group.
              </CardDescription>
            </CardHeader>
            <CardContent className="divide-y divide-border p-0">
              {(signupInvites ?? []).length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No invites yet.</p>
              ) : (
                (signupInvites ?? []).map((inv) => {
                  const used = inv.use_count >= (inv.max_uses ?? 1) || !inv.enabled;
                  return (
                    <div
                      key={inv.id}
                      className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="font-mono text-sm font-semibold tracking-wide">
                          {inv.code}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {inv.label || "Untitled"} ·{" "}
                          {used ? "Used" : "Unused · single use"}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            void navigator.clipboard.writeText(inv.code).then(
                              () => toast.success("Copied"),
                              () => toast.error("Could not copy")
                            );
                          }}
                        >
                          Copy
                        </Button>
                        <span className="text-xs text-muted-foreground">Enabled</span>
                        <Switch
                          checked={inv.enabled}
                          disabled={busy || inv.use_count >= (inv.max_uses ?? 1)}
                          onCheckedChange={(v) => void toggleInvite(inv.id, v)}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Create signup invites</CardTitle>
              <CardDescription>
                Generate one or many unique single-use codes. Each code can only be
                used once.
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
                    <Label htmlFor="invite-count">How many codes</Label>
                    <Input
                      id="invite-count"
                      type="number"
                      min={1}
                      max={50}
                      value={inviteCount}
                      onChange={(e) =>
                        setInviteCount(Number(e.target.value) || 1)
                      }
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Up to 50 at a time
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-send-to">Email codes to (optional)</Label>
                  <Input
                    id="invite-send-to"
                    type="email"
                    value={inviteSendTo}
                    onChange={(e) => setInviteSendTo(e.target.value)}
                    placeholder="friend@email.com"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Requires SMTP env vars. Sends the invite code(s) so they can sign up.
                  </p>
                </div>
                {lastCreatedCodes.length > 1 ? (
                  <div className="space-y-2 rounded-lg bg-muted/50 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Last batch ({lastCreatedCodes.length} codes)
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(lastCreatedCodes.join("\n"))
                            .then(
                              () => toast.success("All codes copied"),
                              () => toast.error("Could not copy")
                            );
                        }}
                      >
                        Copy all
                      </Button>
                    </div>
                    <pre className="max-h-40 overflow-y-auto font-mono text-xs font-semibold tracking-wide">
                      {lastCreatedCodes.join("\n")}
                    </pre>
                  </div>
                ) : lastCreatedCode ? (
                  <p className="rounded-lg bg-muted/50 px-3 py-2 font-mono text-sm font-semibold tracking-wide">
                    Last created: {lastCreatedCode}
                  </p>
                ) : null}
                <Button type="submit" disabled={busy}>
                  {busy && <Loader2 className="animate-spin" />}
                  {inviteCount > 1
                    ? `Generate ${inviteCount} invites`
                    : "Generate invite"}
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
