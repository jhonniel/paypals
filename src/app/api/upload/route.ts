import { getAuthedClient } from "@/lib/supabase/auth";
import { getActiveOcrProviderName } from "@/services/ocr";
import {
  emptyOcrResult,
  extractWithPreprocess,
} from "@/services/ocr/extract-with-preprocess";
import { computeReceiptTotals, moneyNumber } from "@/lib/money";
import { tryReceiptDate, tryReceiptTime } from "@/lib/receipt-datetime";
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

function isUploadBlob(value: FormDataEntryValue | null): boolean {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as Blob).arrayBuffer === "function" &&
    typeof (value as Blob).size === "number" &&
    (value as Blob).size > 0
  );
}

export async function POST(request: Request) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;

    const form = await request.formData();
    const fileEntry = form.get("file");
    if (!isUploadBlob(fileEntry)) {
      return fail("Missing file field");
    }
    const file = fileEntry as Blob;

    const groupIdRaw = form.get("group_id");
    const groupId =
      typeof groupIdRaw === "string" && groupIdRaw.trim().length > 0
        ? groupIdRaw.trim()
        : null;

    if (groupId) {
      const { data: group } = await supabase
        .from("groups")
        .select("id, created_by")
        .eq("id", groupId)
        .maybeSingle();
      if (!group) return fail("Group not found", 404);
      if (group.created_by !== user.id) {
        return fail("Only the group creator can upload receipts to this group", 403);
      }
    }

    const fileName =
      file instanceof File && file.name ? file.name : `receipt-${Date.now()}.jpg`;
    const mime = normalizeMime(file.type, fileName);
    if (!ALLOWED.has(mime) && !ALLOWED.has(file.type)) {
      return fail(`Unsupported file type: ${file.type || mime || "unknown"}`);
    }
    if (file.size > MAX_BYTES) {
      return fail("File too large (max 12MB)");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const receiptId = crypto.randomUUID();
    const ext =
      fileName.split(".").pop()?.toLowerCase() ||
      (mime.includes("pdf") ? "pdf" : "jpg");
    const storagePath = `${user.id}/${receiptId}/original.${ext}`;
    const ocrJsonPath = `${user.id}/${receiptId}/ocr.json`;

    const { data: settings } = await supabase
      .from("user_settings")
      .select("currency")
      .eq("user_id", user.id)
      .maybeSingle();

    const currency = settings?.currency ?? "PHP";

    const { error: receiptError } = await supabase.from("receipts").insert({
      id: receiptId,
      created_by: user.id,
      group_id: groupId,
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

    const { error: imageError } = await supabase.from("receipt_images").insert({
      receipt_id: receiptId,
      storage_path: storagePath,
      mime_type: mime,
      file_size: file.size,
    });
    if (imageError) {
      console.error("receipt_images insert", imageError);
    }

    await supabase.from("receipt_history").insert({
      receipt_id: receiptId,
      user_id: user.id,
      event: "uploaded",
      metadata: { mime, size: file.size, name: fileName },
    });

    const started = Date.now();
    let ocrResult;
    let ocrError: string | null = null;
    let preprocessMeta: {
      preprocessSteps: string[];
      enhanced: boolean;
      usedBinaryPass: boolean;
      pass?: string;
    } | null = null;

    try {
      const ran = await extractWithPreprocess(buffer, mime, fileName);
      ocrResult = ran.result;
      preprocessMeta = ran.meta;
      if (!ocrResult.items.length && ocrResult.total == null) {
        throw new Error("No line items found on receipt");
      }
    } catch (err) {
      // Never inject fake demo (Jollibee) data — leave an empty editable receipt
      ocrError = err instanceof Error ? err.message : "OCR failed";
      console.error("[upload OCR]", ocrError);
      ocrResult = emptyOcrResult(getActiveOcrProviderName(), ocrError);
      preprocessMeta = {
        preprocessSteps: ["failed"],
        enhanced: false,
        usedBinaryPass: false,
      };
    }

    const duration = Date.now() - started;

    await supabase.storage.from("ocr-json").upload(
      ocrJsonPath,
      Buffer.from(JSON.stringify({ ...ocrResult, preprocess: preprocessMeta }, null, 2), "utf8"),
      { contentType: "application/json", upsert: true }
    );

    await supabase.from("ocr_logs").insert({
      receipt_id: receiptId,
      provider: ocrResult.provider,
      status: ocrError ? "ocr_failed" : "success",
      request_meta: {
        mime,
        size: file.size,
        configured: getActiveOcrProviderName(),
        preprocess: preprocessMeta,
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
      tax: 0,
      discount: ocrResult.discount ?? 0,
      serviceCharge: ocrResult.serviceCharge ?? 0,
      tip: ocrResult.tip ?? 0,
    });

    const declaredTotal =
      ocrResult.total !== null && ocrResult.total !== undefined
        ? moneyNumber(ocrResult.total)
        : totals.total;

    const { error: updateError } = await supabase
      .from("receipts")
      .update({
        merchant: ocrResult.merchant,
        receipt_date: ocrResult.date ? tryReceiptDate(ocrResult.date) : null,
        receipt_time: ocrResult.time ? tryReceiptTime(ocrResult.time) : null,
        subtotal: totals.itemsSubtotal,
        tax: 0,
        discount: totals.discount,
        service_charge: totals.serviceCharge,
        tip: totals.tip,
        total: declaredTotal,
        status: "ocr_complete",
        ocr_confidence: ocrResult.confidence,
        notes: ocrError
          ? `OCR could not read this receipt (${ocrError}). Add items manually or tap Re-run OCR.`
          : null,
      })
      .eq("id", receiptId);

    if (updateError) {
      console.error("receipt update after OCR", updateError);
      return fail(`Could not save OCR results: ${updateError.message}`, 400);
    }

    if (ocrResult.items.length > 0) {
      const { insertReceiptItems } = await import("@/lib/insert-receipt-items");
      const { error: itemsError } = await insertReceiptItems(
        supabase,
        receiptId,
        ocrResult.items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          subItems: item.subItems,
        }))
      );
      if (itemsError) {
        console.error("receipt_items insert", itemsError);
        return fail(`Could not save line items: ${itemsError}`, 400);
      }
    }

    await supabase.from("receipt_history").insert({
      receipt_id: receiptId,
      user_id: user.id,
      event: "ocr_complete",
      metadata: {
        provider: ocrResult.provider,
        confidence: ocrResult.confidence,
        items: ocrResult.items.length,
        fallback: Boolean(ocrError),
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
      ocrFailed: Boolean(ocrError),
      warning: ocrError,
    });
  } catch (error) {
    console.error(error);
    return serverError(
      error instanceof Error ? error.message : "Upload failed"
    );
  }
}
