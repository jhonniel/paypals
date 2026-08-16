import { getAuthedClient } from "@/lib/supabase/auth";
import { created, unauthorized, fail, serverError } from "@/lib/api";
import { moneyNumber } from "@/lib/money";
import { applyPalReceivedPayment } from "@/lib/pal-debt-balance";
import { extractPaymentProofFields } from "@/services/ocr/extract-payment-proof";
import { normalizeUploadImage } from "@/lib/convert-heic-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);
const MAX_BYTES = 10 * 1024 * 1024;

function normalizeMime(mime: string, name: string): string {
  const lower = (mime || "").toLowerCase();
  if (lower === "image/jpg") return "image/jpeg";
  if (ALLOWED.has(lower)) return lower;
  const ext = name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    heic: "image/heic",
    heif: "image/heif",
  };
  return map[ext ?? ""] ?? lower;
}

function isUploadBlob(value: FormDataEntryValue | null): boolean {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as Blob).arrayBuffer === "function" &&
    typeof (value as Blob).size === "number" &&
    (value as Blob).size > 0
  );
}

/** Scan payment receipt via OCR (image is not stored), record received payment. */
export async function POST(request: Request) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;

    const form = await request.formData();
    const creditorIdField = String(form.get("creditor_id") ?? "").trim();
    const debtorIdField = String(form.get("debtor_id") ?? "").trim();

    let creditorId: string;
    let debtorId: string;

    if (creditorIdField && !debtorIdField) {
      creditorId = creditorIdField;
      debtorId = user.id;
      if (creditorId === user.id) {
        return fail("You cannot record a payment to yourself", 400);
      }
    } else if (debtorIdField && !creditorIdField) {
      creditorId = user.id;
      debtorId = debtorIdField;
      if (debtorId === user.id) {
        return fail("You cannot record a payment from yourself", 400);
      }
    } else {
      return fail("Send either debtor_id (creditor recording) or creditor_id (you paying)", 400);
    }

    const fileEntry = form.get("file");
    if (!isUploadBlob(fileEntry)) return fail("Missing receipt image", 400);

    const manualAmountRaw = String(form.get("amount") ?? "").trim();
    const manualAmount =
      manualAmountRaw && !Number.isNaN(Number(manualAmountRaw))
        ? moneyNumber(Number(manualAmountRaw))
        : null;
    const manualTxn = String(form.get("transaction_number") ?? "").trim() || null;
    const note = String(form.get("note") ?? "").trim() || null;
    const currency = String(form.get("currency") ?? "PHP").trim().toUpperCase();
    const isDebtorPaying = Boolean(creditorIdField && !debtorIdField);

    const counterpartyId = creditorId === user.id ? debtorId : creditorId;
    const { data: counterparty, error: profileErr } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", counterpartyId)
      .maybeSingle();

    if (profileErr) return fail(profileErr.message, 400);
    if (!counterparty) return fail("User not found", 404);

    const file = fileEntry as Blob;
    const fileName =
      file instanceof File && file.name
        ? file.name
        : `pal-payment-receipt-${Date.now()}.jpg`;
    const mime = normalizeMime(file.type, fileName);
    if (!ALLOWED.has(mime)) {
      return fail("Receipt must be a PNG, JPEG, WebP, GIF, or HEIC image");
    }
    if (file.size > MAX_BYTES) return fail("Receipt image too large (max 10MB)");

    let buffer: Buffer = Buffer.from(await file.arrayBuffer());
    let normalizedName = fileName;
    let normalizedMime = mime;
    try {
      const normalized = await normalizeUploadImage(buffer, mime, fileName);
      buffer = Buffer.from(normalized.buffer);
      normalizedMime = normalized.mimeType;
      normalizedName = normalized.fileName;
    } catch (err) {
      return fail(
        err instanceof Error ? err.message : "Could not read HEIC image",
        400
      );
    }

    let ocrAmount: number | null = null;
    let ocrTxn: string | null = null;
    let ocrMeta: Record<string, unknown> = {};

    try {
      const fields = await extractPaymentProofFields(
        buffer,
        normalizedMime,
        normalizedName
      );
      ocrAmount = fields.amount;
      ocrTxn = fields.transactionNumber;
      ocrMeta = {
        provider: fields.provider,
        textPreview: fields.text.slice(0, 500),
        raw: fields.raw,
        scannedAt: new Date().toISOString(),
      };
    } catch (err) {
      ocrMeta = {
        error: err instanceof Error ? err.message : "OCR failed",
        scannedAt: new Date().toISOString(),
      };
    }

    const paymentAmount = isDebtorPaying ? ocrAmount : (manualAmount ?? ocrAmount);
    if (paymentAmount == null || paymentAmount <= 0) {
      return fail(
        isDebtorPaying
          ? "Could not read the payment amount from your screenshot. Try a clearer image showing the paid amount."
          : "Could not read payment amount from the receipt. Enter the amount manually and try again.",
        422
      );
    }

    const transactionNumber = isDebtorPaying ? ocrTxn : (manualTxn ?? ocrTxn);

    try {
      const result = await applyPalReceivedPayment(
        supabase,
        creditorId,
        debtorId,
        paymentAmount,
        currency,
        note,
        {
          scan: {
            transactionNumber,
            ocrAmount,
            ocrRaw: ocrMeta,
          },
        }
      );

      return created({
        payment: result.payment,
        open_remaining: result.openRemaining,
        credit_balance: result.creditBalance,
        ocr_amount: ocrAmount,
        transaction_number: transactionNumber,
        amount_applied: paymentAmount,
      });
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Could not record payment", 400);
    }
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
