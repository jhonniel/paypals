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
  };
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
      };
    })
    .filter((m): m is PaymentMethod => m != null);

  return methods.slice(0, MAX_PAYMENT_ACCOUNTS);
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
