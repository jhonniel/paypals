import { getAuthedClient } from "@/lib/supabase/auth";
import { getOcrService, getActiveOcrProviderName } from "@/services/ocr";
import { computeReceiptTotals, moneyNumber } from "@/lib/money";
import { fail, unauthorized, serverError, created } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

const MAX_BYTES = 12 * 1024 * 1024; // 12MB

function normalizeMime(mime: string, name: string): string {
  const lower = (mime || "").toLowerCase();
  if (lower && ALLOWED.has(lower)) return lower === "image/jpg" ? "image/jpeg" : lower;
  const ext = name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
    pdf: "application/pdf",
  };
  return map[ext ?? ""] ?? lower;
}

export async function POST(request: Request) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return fail("Missing file field");
    }

    const mime = normalizeMime(file.type, file.name);
    if (!ALLOWED.has(mime) && !ALLOWED.has(file.type)) {
      return fail(`Unsupported file type: ${file.type || mime || "unknown"}`);
    }
    if (file.size > MAX_BYTES) {
      return fail("File too large (max 12MB)");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const receiptId = crypto.randomUUID();
    const ext =
      file.name.split(".").pop()?.toLowerCase() ||
      (mime.includes("pdf") ? "pdf" : "jpg");
    const storagePath = `${user.id}/${receiptId}/original.${ext}`;
    const ocrJsonPath = `${user.id}/${receiptId}/ocr.json`;

    // Create receipt shell
    const { data: settings } = await supabase
      .from("user_settings")
      .select("currency")
      .eq("user_id", user.id)
      .maybeSingle();

    const currency = settings?.currency ?? "PHP";

    const { error: receiptError } = await supabase.from("receipts").insert({
      id: receiptId,
      created_by: user.id,
      currency,
      status: "uploaded",
      merchant: null,
      subtotal: 0,
      tax: 0,
      discount: 0,
      service_charge: 0,
      tip: 0,
      total: 0,
    });

    if (receiptError) return fail(receiptError.message, 400);

    const { error: uploadError } = await supabase.storage
      .from("receipts")
      .upload(storagePath, buffer, {
        contentType: mime,
        upsert: true,
      });

    if (uploadError) {
      await supabase.from("receipts").delete().eq("id", receiptId);
      return fail(`Storage upload failed: ${uploadError.message}`, 400);
    }

    await supabase.from("receipt_images").insert({
      receipt_id: receiptId,
      storage_path: storagePath,
      mime_type: mime,
      file_size: file.size,
    });

    await supabase.from("receipt_history").insert({
      receipt_id: receiptId,
      user_id: user.id,
      event: "uploaded",
      metadata: { mime, size: file.size, name: file.name },
    });

    // OCR
    const started = Date.now();
    const ocr = getOcrService();
    let ocrResult;
    let ocrError: string | null = null;

    try {
      ocrResult = await ocr.extract({
        buffer,
        mimeType: mime,
        fileName: file.name,
      });
    } catch (err) {
      ocrError = err instanceof Error ? err.message : "OCR failed";
      const { DemoOcrProvider } = await import("@/services/ocr/providers/demo");
      ocrResult = await new DemoOcrProvider().extract({
        buffer,
        mimeType: mime,
        fileName: file.name,
      });
    }

    const duration = Date.now() - started;

    await supabase.storage.from("ocr-json").upload(
      ocrJsonPath,
      Buffer.from(JSON.stringify(ocrResult, null, 2), "utf8"),
      { contentType: "application/json", upsert: true }
    );

    await supabase.from("ocr_logs").insert({
      receipt_id: receiptId,
      provider: ocrResult.provider,
      status: ocrError ? "fallback_success" : "success",
      request_meta: {
        mime,
        size: file.size,
        configured: getActiveOcrProviderName(),
      },
      response_meta: { itemCount: ocrResult.items.length },
      confidence: ocrResult.confidence,
      error_message: ocrError,
      duration_ms: duration,
    });

    const totals = computeReceiptTotals({
      items: ocrResult.items.map((i) => ({
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        totalPrice: i.totalPrice,
      })),
      tax: ocrResult.tax ?? 0,
      discount: ocrResult.discount ?? 0,
      serviceCharge: ocrResult.serviceCharge ?? 0,
      tip: ocrResult.tip ?? 0,
    });

    const declaredTotal =
      ocrResult.total !== null && ocrResult.total !== undefined
        ? moneyNumber(ocrResult.total)
        : totals.total;

    await supabase
      .from("receipts")
      .update({
        merchant: ocrResult.merchant,
        receipt_date: ocrResult.date ? tryDate(ocrResult.date) : null,
        receipt_time: ocrResult.time ? tryTime(ocrResult.time) : null,
        subtotal: totals.itemsSubtotal,
        tax: totals.tax,
        discount: totals.discount,
        service_charge: totals.serviceCharge,
        tip: totals.tip,
        total: declaredTotal,
        status: "ocr_complete",
        ocr_confidence: ocrResult.confidence,
      })
      .eq("id", receiptId);

    if (ocrResult.items.length > 0) {
      await supabase.from("receipt_items").insert(
        ocrResult.items.map((item, index) => ({
          receipt_id: receiptId,
          name: item.name,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          total_price: item.totalPrice,
          sort_order: index,
        }))
      );
    }

    await supabase.from("receipt_history").insert({
      receipt_id: receiptId,
      user_id: user.id,
      event: "ocr_complete",
      metadata: {
        provider: ocrResult.provider,
        confidence: ocrResult.confidence,
        items: ocrResult.items.length,
      },
    });

    await supabase.from("activities").insert({
      user_id: user.id,
      receipt_id: receiptId,
      action: "receipt_uploaded",
      metadata: { merchant: ocrResult.merchant },
    });

    return created({
      id: receiptId,
      merchant: ocrResult.merchant,
      itemCount: ocrResult.items.length,
      confidence: ocrResult.confidence,
      provider: ocrResult.provider,
      usedFallback: Boolean(ocrError),
      warning: ocrError,
    });
  } catch (error) {
    console.error(error);
    return serverError(
      error instanceof Error ? error.message : "Upload failed"
    );
  }
}

function tryDate(raw: string): string | null {
  const cleaned = raw.trim();
  // DD/MM/YYYY or MM/DD/YYYY → prefer ISO when unambiguous
  const m = cleaned.match(/(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})/);
  if (!m) return null;
  let y: string, mo: string, d: string;
  if (m[1].length === 4) {
    y = m[1];
    mo = m[2].padStart(2, "0");
    d = m[3].padStart(2, "0");
  } else if (m[3].length === 4) {
    // assume D/M/Y common in PH
    d = m[1].padStart(2, "0");
    mo = m[2].padStart(2, "0");
    y = m[3];
  } else {
    return null;
  }
  const iso = `${y}-${mo}-${d}`;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  return iso;
}

function tryTime(raw: string): string | null {
  const m = raw.trim().match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2];
  const sec = m[3] ?? "00";
  const ap = m[4]?.toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${min}:${sec}`;
}
