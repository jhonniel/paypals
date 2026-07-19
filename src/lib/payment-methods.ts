import type { SupabaseClient } from "@supabase/supabase-js";

export const PAYMENT_METHOD_TYPES = ["gcash", "maya", "bank", "other"] as const;
export const MAX_PAYMENT_ACCOUNTS = 3;

export type PaymentMethodType = (typeof PAYMENT_METHOD_TYPES)[number];

export type PaymentMethod = {
  id: string;
  type: PaymentMethodType;
  /** Bank or wallet name (e.g. BDO, GCash). */
  bank_name: string;
  /** Name on the receiving account. */
  account_name: string;
  account_number: string;
  qr_code_url: string | null;
  /** Include this account in “Send payment to”. */
  show_account: boolean;
  show_account_name: boolean;
  show_account_number: boolean;
  show_qr: boolean;
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodType, string> = {
  gcash: "GCash",
  maya: "Maya",
  bank: "Bank",
  other: "Other",
};

function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `pm_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function boolOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function createEmptyPaymentMethod(
  type: PaymentMethodType = "bank"
): PaymentMethod {
  return {
    id: newId(),
    type,
    bank_name: type === "bank" ? "" : PAYMENT_METHOD_LABELS[type],
    account_name: "",
    account_number: "",
    qr_code_url: null,
    show_account: true,
    show_account_name: true,
    show_account_number: true,
    show_qr: true,
  };
}

/** At most one account may be shown to friends. */
export function ensureSingleShownAccount(
  methods: PaymentMethod[],
  preferId?: string | null
): PaymentMethod[] {
  if (methods.length === 0) return methods;
  const preferred =
    (preferId && methods.find((m) => m.id === preferId && m.show_account)) ||
    methods.find((m) => m.show_account) ||
    null;
  const shownId = preferred?.id ?? null;
  return methods.map((m) => ({
    ...m,
    show_account: shownId ? m.id === shownId : false,
  }));
}

export function normalizePaymentMethods(raw: unknown): PaymentMethod[] {
  if (!Array.isArray(raw)) return [];
  const methods = raw
    .map((row): PaymentMethod | null => {
      if (!row || typeof row !== "object") return null;
      const r = row as Record<string, unknown>;
      const type = PAYMENT_METHOD_TYPES.includes(r.type as PaymentMethodType)
        ? (r.type as PaymentMethodType)
        : "bank";

      const bank_name =
        (typeof r.bank_name === "string" && r.bank_name.trim()) ||
        (typeof r.label === "string" && r.label.trim()) ||
        PAYMENT_METHOD_LABELS[type];

      const account_name =
        typeof r.account_name === "string" ? r.account_name.trim() : "";

      const account_number =
        (typeof r.account_number === "string" && r.account_number.trim()) ||
        (typeof r.details === "string" && r.details.trim()) ||
        "";

      const qr_code_url =
        typeof r.qr_code_url === "string" && r.qr_code_url.trim()
          ? r.qr_code_url.trim()
          : null;

      if (!account_name && !account_number && !qr_code_url) return null;

      return {
        id:
          typeof r.id === "string" && r.id.trim() ? r.id.trim() : newId(),
        type,
        bank_name,
        account_name,
        account_number,
        qr_code_url,
        show_account: boolOrDefault(r.show_account, true),
        show_account_name: boolOrDefault(r.show_account_name, true),
        show_account_number: boolOrDefault(r.show_account_number, true),
        show_qr: boolOrDefault(r.show_qr, true),
      };
    })
    .filter((m): m is PaymentMethod => m != null);

  return ensureSingleShownAccount(methods.slice(0, MAX_PAYMENT_ACCOUNTS));
}

/** What friends see when settling — respects per-field show toggles. */
export function toSharedPaymentMethods(methods: PaymentMethod[]): PaymentMethod[] {
  return methods
    .filter((m) => m.show_account)
    .map((m) => ({
      ...m,
      account_name: m.show_account_name ? m.account_name : "",
      account_number: m.show_account_number ? m.account_number : "",
      qr_code_url: m.show_qr ? m.qr_code_url : null,
    }))
    .filter(
      (m) =>
        Boolean(m.account_name) ||
        Boolean(m.account_number) ||
        Boolean(m.qr_code_url)
    );
}

export function paymentMethodDisplayLabel(m: PaymentMethod): string {
  return m.bank_name || PAYMENT_METHOD_LABELS[m.type];
}

export function paymentMethodCopyText(m: PaymentMethod): string {
  return [
    paymentMethodDisplayLabel(m),
    m.account_name ? `Account name: ${m.account_name}` : null,
    m.account_number ? `Account number: ${m.account_number}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Resolve a public QR URL from storage when the profile field is missing. */
export async function resolvePaymentQrUrl(
  supabase: SupabaseClient,
  userId: string,
  accountId: string,
  existingUrl: string | null
): Promise<string | null> {
  if (existingUrl?.trim()) return existingUrl.trim();

  const { data: files } = await supabase.storage
    .from("payment-qr")
    .list(userId, { limit: 100 });
  const images = (files ?? []).filter((f) =>
    /\.(png|jpe?g|webp|gif)$/i.test(f.name)
  );
  const match =
    images.find((f) => f.name.startsWith(`${accountId}.`)) ??
    (images.length === 1 ? images[0] : undefined);
  if (match) {
    const {
      data: { publicUrl },
    } = supabase.storage
      .from("payment-qr")
      .getPublicUrl(`${userId}/${match.name}`);
    if (publicUrl) return publicUrl;
  }

  // list() can fail under RLS — probe common paths directly
  for (const ext of ["png", "jpg", "jpeg", "webp", "gif"]) {
    const path = `${userId}/${accountId}.${ext}`;
    const {
      data: { publicUrl },
    } = supabase.storage.from("payment-qr").getPublicUrl(path);
    try {
      const res = await fetch(publicUrl, { method: "HEAD" });
      if (res.ok) return publicUrl;
    } catch {
      /* keep trying */
    }
  }

  return null;
}
