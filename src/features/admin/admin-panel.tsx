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
  counts: { users: number; receipts: number; groups: number };
  users: Array<{
    id: string;
    email: string | null;
    full_name: string | null;
    username: string | null;
    is_admin: boolean;
    created_at: string;
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

  async function toggleAdmin(userId: string, is_admin: boolean) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, is_admin }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Update failed");
      toast.success(is_admin ? "Granted admin" : "Removed admin");
      void qc.invalidateQueries({ queryKey: ["admin"] });
    } catch (err) {
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

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Users", value: data.counts.users, icon: Users },
          { label: "Receipts", value: data.counts.receipts, icon: Receipt },
          { label: "Groups", value: data.counts.groups, icon: Activity },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="flex items-center gap-3 p-4">
              <s.icon className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-xl font-semibold tabular-nums">{s.value}</p>
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
            <TabsTrigger value="receipts">Receipts</TabsTrigger>
            <TabsTrigger value="ocr">OCR logs</TabsTrigger>
            <TabsTrigger value="flags">Feature flags</TabsTrigger>
            <TabsTrigger value="audit">Audit</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="users" className="mt-4">
          <Card>
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
