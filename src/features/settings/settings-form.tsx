"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Download, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_TYPES,
  MAX_PAYMENT_ACCOUNTS,
  createEmptyPaymentMethod,
  normalizePaymentMethods,
  type PaymentMethod,
  type PaymentMethodType,
} from "@/lib/payment-methods";

type SettingsState = {
  theme: "light" | "dark" | "system";
  currency: string;
  timezone: string;
  language: string;
  notification_email: boolean;
  notification_push: boolean;
  ocr_provider: string | null;
};

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function SettingsForm() {
  const router = useRouter();
  const { setTheme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState("");
  const [usage, setUsage] = useState<{
    totalBytes: number;
    receiptBytes: number;
    avatarBytes: number;
    ocrBytes: number;
    paymentQrBytes?: number;
    fileCount: number;
    receiptCount: number;
  } | null>(null);
  const [settings, setSettings] = useState<SettingsState>({
    theme: "system",
    currency: "PHP",
    timezone: "UTC",
    language: "en",
    notification_email: true,
    notification_push: true,
    ocr_provider: null,
  });
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [savingPayout, setSavingPayout] = useState(false);
  const [uploadingQrIndex, setUploadingQrIndex] = useState<number | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    async function load() {
      const [profileRes, usageRes] = await Promise.all([
        fetch("/api/profile"),
        fetch("/api/account/usage"),
      ]);
      const json = await profileRes.json();
      if (!profileRes.ok) {
        toast.error(json?.error?.message ?? "Failed to load settings");
        setLoading(false);
        return;
      }
      const s = json.data.settings;
      setSettings({
        theme: s.theme ?? "system",
        currency: s.currency ?? "PHP",
        timezone: s.timezone ?? "UTC",
        language: s.language ?? "en",
        notification_email: s.notification_email ?? true,
        notification_push: s.notification_push ?? true,
        ocr_provider: s.ocr_provider ?? null,
      });
      setPaymentMethods(normalizePaymentMethods(json.data.profile?.payment_methods));
      setIsAdmin(Boolean(json.data.profile?.is_admin));

      if (usageRes.ok) {
        const u = await usageRes.json();
        setUsage(u.data.storage);
      }
      setLoading(false);
    }
    void load();
  }, []);

  async function save(partial: Partial<SettingsState>) {
    const next = { ...settings, ...partial };
    setSettings(next);
    setSaving(true);
    try {
      if (partial.theme) setTheme(partial.theme);
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partial),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Save failed");
      toast.success("Settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function exportData() {
    setExporting(true);
    try {
      const res = await fetch("/api/account");
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error?.message ?? "Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `paypals-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function savePayout() {
    if (paymentMethods.length > 0) {
      const incomplete = paymentMethods.filter(
        (m) => !m.account_name.trim() || !m.account_number.trim()
      );
      if (incomplete.length) {
        toast.error("Each account needs an account name and account number");
        return;
      }
    }
    setSavingPayout(true);
    try {
      const cleaned = normalizePaymentMethods(paymentMethods);
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_methods: cleaned }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Save failed");
      setPaymentMethods(normalizePaymentMethods(json.data.profile?.payment_methods));
      toast.success("Payout accounts saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingPayout(false);
    }
  }

  function addPaymentMethod() {
    if (paymentMethods.length >= MAX_PAYMENT_ACCOUNTS) {
      toast.error(`You can add up to ${MAX_PAYMENT_ACCOUNTS} receiving accounts`);
      return;
    }
    setPaymentMethods((prev) => [...prev, createEmptyPaymentMethod("bank")]);
  }

  function updatePaymentMethod(index: number, patch: Partial<PaymentMethod>) {
    setPaymentMethods((prev) =>
      prev.map((m, i) => {
        if (i !== index) return m;
        const next = { ...m, ...patch };
        if (patch.type && patch.bank_name === undefined && !m.bank_name) {
          next.bank_name = PAYMENT_METHOD_LABELS[patch.type];
        }
        return next;
      })
    );
  }

  async function uploadQr(index: number, file: File) {
    const account = paymentMethods[index];
    if (!account) return;
    setUploadingQrIndex(index);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("account_id", account.id);
      const res = await fetch("/api/payment-qr", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Upload failed");
      updatePaymentMethod(index, { qr_code_url: json.data.url as string });
      toast.success("QR uploaded — save payout accounts to keep it");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "QR upload failed");
    } finally {
      setUploadingQrIndex(null);
    }
  }

  async function deleteAccount() {
    if (confirmDelete !== "DELETE") {
      toast.error('Type DELETE to confirm');
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Delete failed");
      toast.success("Account deleted");
      router.push("/");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) return <Skeleton className="h-80 w-full max-w-2xl" />;

  return (
    <Tabs defaultValue="preferences" className="w-full max-w-2xl">
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <TabsList className="inline-flex h-auto min-w-full w-max sm:min-w-0 sm:w-auto">
          <TabsTrigger value="preferences" className="flex-1 sm:flex-none">
            Preferences
          </TabsTrigger>
          <TabsTrigger value="payout" className="flex-1 sm:flex-none">
            Payout
          </TabsTrigger>
          <TabsTrigger value="notifications" className="flex-1 sm:flex-none">
            Notifications
          </TabsTrigger>
          <TabsTrigger value="data" className="flex-1 sm:flex-none">
            Data & privacy
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="preferences">
        <Card>
          <CardHeader>
            <CardTitle>Preferences</CardTitle>
            <CardDescription>Theme, currency, locale, and OCR.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label>Theme</Label>
              <div className="flex flex-wrap gap-2">
                {(["light", "dark", "system"] as const).map((t) => (
                  <Button
                    key={t}
                    type="button"
                    size="sm"
                    variant={settings.theme === t ? "default" : "outline"}
                    onClick={() => void save({ theme: t })}
                    className="capitalize"
                  >
                    {t}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
              <Input
                id="currency"
                value={settings.currency}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, currency: e.target.value.toUpperCase() }))
                }
                onBlur={() => void save({ currency: settings.currency })}
                maxLength={3}
                placeholder="PHP"
              />
              <p className="text-xs text-muted-foreground">
                Default is Philippine Peso (PHP). Use ISO codes like PHP, USD, EUR.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="timezone">Timezone</Label>
              <Input
                id="timezone"
                value={settings.timezone}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, timezone: e.target.value }))
                }
                onBlur={() => void save({ timezone: settings.timezone })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="language">Language</Label>
              <Input
                id="language"
                value={settings.language}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, language: e.target.value }))
                }
                onBlur={() => void save({ language: settings.language })}
              />
            </div>
            {isAdmin && (
              <div className="space-y-2">
                <Label>OCR provider preference</Label>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      { value: null, label: "System default" },
                      { value: "ocrspace", label: "OCR.Space" },
                      { value: "google", label: "Google Vision" },
                      { value: "openai", label: "OpenAI" },
                      { value: "tesseract", label: "Tesseract" },
                    ] as const
                  ).map((opt) => (
                    <Button
                      key={String(opt.value)}
                      type="button"
                      size="sm"
                      variant={settings.ocr_provider === opt.value ? "default" : "outline"}
                      onClick={() => void save({ ocr_provider: opt.value })}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Used when re-running OCR if the server allows that provider.
                </p>
              </div>
            )}
            {saving && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Saving…
              </p>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="payout">
        <Card>
          <CardHeader>
            <CardTitle>Receiving accounts</CardTitle>
            <CardDescription>
              Add up to {MAX_PAYMENT_ACCOUNTS} accounts. Friends see the account name,
              number, and QR when you paid a shared bill.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {paymentMethods.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No receiving accounts yet. Add one so people know where to pay you.
              </p>
            )}
            {paymentMethods.map((m, index) => (
              <div
                key={m.id}
                className="space-y-3 rounded-2xl border border-border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Account {index + 1}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setPaymentMethods((prev) => prev.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </Button>
                </div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <select
                    className="flex h-11 w-full rounded-xl border border-input bg-surface-elevated/60 px-3 text-sm"
                    value={m.type}
                    onChange={(e) =>
                      updatePaymentMethod(index, {
                        type: e.target.value as PaymentMethodType,
                      })
                    }
                  >
                    {PAYMENT_METHOD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {PAYMENT_METHOD_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`bank-name-${index}`}>Bank / wallet name</Label>
                  <Input
                    id={`bank-name-${index}`}
                    value={m.bank_name}
                    onChange={(e) =>
                      updatePaymentMethod(index, { bank_name: e.target.value })
                    }
                    placeholder="BDO, GCash, Maya…"
                    maxLength={80}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`account-name-${index}`}>Account name</Label>
                  <Input
                    id={`account-name-${index}`}
                    value={m.account_name}
                    onChange={(e) =>
                      updatePaymentMethod(index, { account_name: e.target.value })
                    }
                    placeholder="Name on the account"
                    maxLength={120}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`account-number-${index}`}>Account number</Label>
                  <Input
                    id={`account-number-${index}`}
                    value={m.account_number}
                    onChange={(e) =>
                      updatePaymentMethod(index, { account_number: e.target.value })
                    }
                    placeholder="Account or mobile number"
                    maxLength={64}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`qr-${index}`}>Payment QR code</Label>
                  {m.qr_code_url ? (
                    <div className="flex flex-wrap items-start gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={m.qr_code_url}
                        alt={`QR for ${m.account_name || "account"}`}
                        className="h-28 w-28 rounded-xl border border-border bg-white object-contain p-1"
                      />
                      <div className="flex flex-col gap-2">
                        <label className="inline-flex cursor-pointer">
                          <input
                            id={`qr-${index}`}
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            className="sr-only"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) void uploadQr(index, file);
                              e.target.value = "";
                            }}
                          />
                          <span className="inline-flex h-8 items-center gap-2 rounded-lg border border-border px-3 text-xs font-medium hover:bg-muted/60">
                            {uploadingQrIndex === index ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : null}
                            Replace QR
                          </span>
                        </label>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            updatePaymentMethod(index, { qr_code_url: null })
                          }
                        >
                          Remove QR
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <label className="flex cursor-pointer flex-col items-start gap-2 rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground hover:bg-muted/40">
                      <input
                        id={`qr-${index}`}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void uploadQr(index, file);
                          e.target.value = "";
                        }}
                      />
                      {uploadingQrIndex === index ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Uploading…
                        </span>
                      ) : (
                        <span>Tap to upload QR (PNG, JPEG, WebP — max 5MB)</span>
                      )}
                    </label>
                  )}
                </div>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={addPaymentMethod}
                disabled={paymentMethods.length >= MAX_PAYMENT_ACCOUNTS}
              >
                <Plus className="h-4 w-4" />
                Add account
                {paymentMethods.length > 0
                  ? ` (${paymentMethods.length}/${MAX_PAYMENT_ACCOUNTS})`
                  : ""}
              </Button>
              <Button
                type="button"
                onClick={() => void savePayout()}
                disabled={savingPayout}
              >
                {savingPayout ? <Loader2 className="animate-spin" /> : null}
                Save payout accounts
              </Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="notifications">
        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>Choose how Paypals reaches you.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Email notifications</p>
                <p className="text-xs text-muted-foreground">
                  Invitations, reminders, and split updates.
                </p>
              </div>
              <Switch
                checked={settings.notification_email}
                onCheckedChange={(v) => void save({ notification_email: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Push notifications</p>
                <p className="text-xs text-muted-foreground">
                  Realtime alerts in supported browsers.
                </p>
              </div>
              <Switch
                checked={settings.notification_push}
                onCheckedChange={(v) => void save({ notification_push: v })}
              />
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="data" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Storage usage</CardTitle>
            <CardDescription>Receipt images, avatars, payment QR, and OCR JSON.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {usage ? (
              <>
                <p>
                  <span className="text-muted-foreground">Total:</span>{" "}
                  <span className="font-semibold tabular-nums">
                    {formatBytes(usage.totalBytes)}
                  </span>{" "}
                  across {usage.fileCount} files · {usage.receiptCount} receipts
                </p>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li>Receipts: {formatBytes(usage.receiptBytes)}</li>
                  <li>Avatars: {formatBytes(usage.avatarBytes)}</li>
                  <li>OCR JSON: {formatBytes(usage.ocrBytes)}</li>
                  <li>Payment QR: {formatBytes(usage.paymentQrBytes ?? 0)}</li>
                </ul>
              </>
            ) : (
              <p className="text-muted-foreground">Usage unavailable.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Export your data</CardTitle>
            <CardDescription>
              Download a JSON archive of your profile, receipts, groups, and activity.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => void exportData()} disabled={exporting}>
              {exporting ? <Loader2 className="animate-spin" /> : <Download className="h-4 w-4" />}
              Export JSON
            </Button>
          </CardContent>
        </Card>

        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">Delete account</CardTitle>
            <CardDescription>
              Permanently removes your profile, receipts you own, and auth identity.
              Type DELETE to confirm.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              value={confirmDelete}
              onChange={(e) => setConfirmDelete(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
            />
            <Button
              variant="destructive"
              disabled={deleting || confirmDelete !== "DELETE"}
              onClick={() => void deleteAccount()}
            >
              {deleting ? <Loader2 className="animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete forever
            </Button>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
