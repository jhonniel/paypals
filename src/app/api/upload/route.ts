import { getAuthedClient } from "@/lib/supabase/auth";
import { getActiveOcrProviderName, getOcrConfigurationError } from "@/services/ocr";
import {
  emptyOcrResult,
  extractWithPreprocess,
} from "@/services/ocr/extract-with-preprocess";
import { computeReceiptTotals, moneyNumber } from "@/lib/money";
import { tryReceiptDate, tryReceiptTime } from "@/lib/receipt-datetime";
import { fail, unauthorized, serverError, created } from "@/lib/api";
import { normalizeUploadImage } from "@/lib/convert-heic-server";
import {
  fetchReceiptDiscountsByReceiptIds,
  insertReceiptDiscounts,
  normalizeDiscountRows,
  sumDiscountAmount,
} from "@/lib/receipt-discounts";

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

const MAX_BYTES = 4 * 1024 * 1024; // ~4MB — under Vercel serverless body limit

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

    const receiptIdRaw = form.get("receipt_id");
    const appendReceiptId =
      typeof receiptIdRaw === "string" && receiptIdRaw.trim().length > 0
        ? receiptIdRaw.trim()
        : null;

    let existingReceipt: {
      id: string;
      created_by: string;
      group_id: string | null;
      merchant: string | null;
      notes: string | null;
      status: string;
      receipt_date: string | null;
      receipt_time: string | null;
      service_charge: number | null;
      tip: number | null;
    } | null = null;

    if (appendReceiptId) {
      const { data: receipt } = await supabase
        .from("receipts")
        .select(
          "id, created_by, group_id, merchant, notes, status, receipt_date, receipt_time, service_charge, tip"
        )
        .eq("id", appendReceiptId)
        .maybeSingle();
      if (!receipt) return fail("Receipt not found", 404);
      if (receipt.created_by !== user.id) {
        return fail("You can only add pages to your own receipts", 403);
      }
      if (receipt.status === "finalized") {
        return fail("Cannot add pages to a finalized receipt", 400);
      }
      existingReceipt = receipt;
    }

    if (groupId && !appendReceiptId) {
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

    let fileName =
      file instanceof File && file.name ? file.name : `receipt-${Date.now()}.jpg`;
    let mime = normalizeMime(file.type, fileName);
    if (!ALLOWED.has(mime) && !ALLOWED.has(file.type)) {
      return fail(`Unsupported file type: ${file.type || mime || "unknown"}`);
    }
    if (file.size > MAX_BYTES) {
      return fail(
        "File too large after compression (max ~4MB). Try a smaller photo or PDF.",
        413
      );
    }

    let buffer: Buffer = Buffer.from(await file.arrayBuffer());
    try {
      const normalized = await normalizeUploadImage(buffer, mime, fileName);
      buffer = Buffer.from(normalized.buffer);
      mime = normalized.mimeType;
      fileName = normalized.fileName;
    } catch (err) {
      return fail(
        err instanceof Error ? err.message : "Could not read image file",
        400
      );
    }

    const receiptId = appendReceiptId ?? crypto.randomUUID();
    const ext =
      fileName.split(".").pop()?.toLowerCase() ||
      (mime.includes("pdf") ? "pdf" : "jpg");

    let storagePath: string;
    let pageNum = 1;
    if (appendReceiptId) {
      const { count: imageCount } = await supabase
        .from("receipt_images")
        .select("id", { count: "exact", head: true })
        .eq("receipt_id", receiptId);
      pageNum = (imageCount ?? 0) + 1;
      storagePath =
        pageNum === 1
          ? `${user.id}/${receiptId}/original.${ext}`
          : `${user.id}/${receiptId}/page-${pageNum}.${ext}`;
    } else {
      storagePath = `${user.id}/${receiptId}/original.${ext}`;
    }
    const ocrJsonPath = appendReceiptId
      ? `${user.id}/${receiptId}/ocr-page-${pageNum}.json`
      : `${user.id}/${receiptId}/ocr.json`;

    const { data: settings } = await supabase
      .from("user_settings")
      .select("currency")
      .eq("user_id", user.id)
      .maybeSingle();

    const currency = settings?.currency ?? "PHP";

    if (!appendReceiptId) {
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
    }

    const { error: uploadError } = await supabase.storage
      .from("receipts")
      .upload(storagePath, buffer, {
        contentType: mime,
        upsert: true,
      });

    if (uploadError) {
      if (!appendReceiptId) {
        await supabase.from("receipts").delete().eq("id", receiptId);
      }
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

    const skipOcrRaw = form.get("skip_ocr");
    const skipOcr = skipOcrRaw === "1" || skipOcrRaw === "true";

    if (skipOcr) {
      const attachNote =
        "Receipt photo attached — add items manually or run OCR from the editor.";
      const receiptUpdate: Record<string, unknown> = { status: "uploaded" };
      if (!appendReceiptId) {
        receiptUpdate.notes = attachNote;
      }

      const { error: skipUpdateError } = await supabase
        .from("receipts")
        .update(receiptUpdate)
        .eq("id", receiptId);

      if (skipUpdateError) {
        return fail(`Could not save receipt: ${skipUpdateError.message}`, 400);
      }

      await supabase.from("receipt_history").insert({
        receipt_id: receiptId,
        user_id: user.id,
        event: appendReceiptId ? "page_uploaded" : "attached",
        metadata: {
          attachOnly: true,
          mime,
          size: file.size,
          name: fileName,
        },
      });

      await supabase.from("activities").insert({
        user_id: user.id,
        receipt_id: receiptId,
        action: appendReceiptId ? "receipt_page_uploaded" : "receipt_uploaded",
        metadata: { attachOnly: true },
      });

      const { count: pageCount } = await supabase
        .from("receipt_images")
        .select("id", { count: "exact", head: true })
        .eq("receipt_id", receiptId);

      return created({
        id: receiptId,
        itemCount: 0,
        totalItemCount: 0,
        pageCount: pageCount ?? 1,
        skippedOcr: true,
        appended: Boolean(appendReceiptId),
      });
    }

    const started = Date.now();
    let ocrResult;
    let ocrError: string | null = getOcrConfigurationError();
    const ocrNotConfigured = Boolean(ocrError);
    let preprocessMeta: {
      preprocessSteps: string[];
      enhanced: boolean;
      usedBinaryPass: boolean;
      pass?: string;
    } | null = null;

    if (!ocrError) {
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
    } else {
      console.warn("[upload OCR]", ocrError);
      ocrResult = emptyOcrResult(getActiveOcrProviderName(), ocrError);
      preprocessMeta = {
        preprocessSteps: ["not_configured"],
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

    let itemSortOffset = 0;
    if (appendReceiptId) {
      const { data: existingItems } = await supabase
        .from("receipt_items")
        .select("sort_order")
        .eq("receipt_id", receiptId)
        .order("sort_order", { ascending: false })
        .limit(1);
      itemSortOffset =
        existingItems?.length && existingItems[0]?.sort_order != null
          ? Number(existingItems[0].sort_order) + 1
          : 0;
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
        })),
        itemSortOffset
      );
      if (itemsError) {
        console.error("receipt_items insert", itemsError);
        return fail(`Could not save line items: ${itemsError}`, 400);
      }
    }

    const ocrDiscountRows =
      ocrResult.discountLines ??
      (ocrResult.discount != null && ocrResult.discount > 0
        ? [{ label: "Discount", amount: ocrResult.discount }]
        : []);

    if (ocrDiscountRows.length > 0 || appendReceiptId) {
      const existingDiscountMap = appendReceiptId
        ? await fetchReceiptDiscountsByReceiptIds(supabase, [receiptId])
        : new Map();
      const existingDiscounts = existingDiscountMap.get(receiptId) ?? [];
      const mergedDiscounts = [
        ...existingDiscounts,
        ...ocrDiscountRows.map((row, index) => ({
          label: row.label,
          amount: row.amount,
          sort_order: existingDiscounts.length + index,
        })),
      ];
      if (mergedDiscounts.length > 0) {
        await insertReceiptDiscounts(supabase, receiptId, mergedDiscounts);
      }
    }

    const { data: allItems } = await supabase
      .from("receipt_items")
      .select("quantity, unit_price, total_price")
      .eq("receipt_id", receiptId);

    const discountMap = await fetchReceiptDiscountsByReceiptIds(supabase, [receiptId]);
    const allDiscounts = normalizeDiscountRows(
      discountMap.get(receiptId),
      appendReceiptId ? undefined : totals.discount
    );
    const discountTotal = sumDiscountAmount(allDiscounts);

    const mergedTotals = computeReceiptTotals({
      items: (allItems ?? []).map((item) => ({
        quantity: Number(item.quantity),
        unitPrice: Number(item.unit_price),
        totalPrice: Number(item.total_price),
      })),
      tax: 0,
      discount: discountTotal,
      serviceCharge: appendReceiptId
        ? Number(existingReceipt?.service_charge ?? 0) || totals.serviceCharge
        : totals.serviceCharge,
      tip: appendReceiptId
        ? Number(existingReceipt?.tip ?? 0) || totals.tip
        : totals.tip,
    });

    const receiptUpdate: Record<string, unknown> = {
      subtotal: mergedTotals.itemsSubtotal,
      tax: 0,
      discount: mergedTotals.discount,
      service_charge: mergedTotals.serviceCharge,
      tip: mergedTotals.tip,
      total: appendReceiptId ? mergedTotals.total : declaredTotal,
      status: "ocr_complete",
      ocr_confidence: ocrResult.confidence,
    };

    if (!appendReceiptId) {
      Object.assign(receiptUpdate, {
        merchant: ocrResult.merchant,
        receipt_date: ocrResult.date ? tryReceiptDate(ocrResult.date) : null,
        receipt_time: ocrResult.time ? tryReceiptTime(ocrResult.time) : null,
        notes: ocrError
          ? ocrNotConfigured
            ? `${ocrError} Restart the dev server after updating .env.local.`
            : `OCR could not read this receipt (${ocrError}). Add items manually or tap Re-run OCR.`
          : null,
      });
    } else if (existingReceipt) {
      if (!existingReceipt.merchant && ocrResult.merchant) {
        receiptUpdate.merchant = ocrResult.merchant;
      }
      if (!existingReceipt.receipt_date && ocrResult.date) {
        receiptUpdate.receipt_date = tryReceiptDate(ocrResult.date);
      }
      if (!existingReceipt.receipt_time && ocrResult.time) {
        receiptUpdate.receipt_time = tryReceiptTime(ocrResult.time);
      }
      if (ocrError) {
        const pageNote = `Page OCR issue: ${ocrError}`;
        receiptUpdate.notes = existingReceipt.notes
          ? `${existingReceipt.notes}\n${pageNote}`
          : pageNote;
      }
    }

    const { error: updateError } = await supabase
      .from("receipts")
      .update(receiptUpdate)
      .eq("id", receiptId);

    if (updateError) {
      console.error("receipt update after OCR", updateError);
      return fail(`Could not save OCR results: ${updateError.message}`, 400);
    }

    await supabase.from("receipt_history").insert({
      receipt_id: receiptId,
      user_id: user.id,
      event: appendReceiptId ? "page_uploaded" : "ocr_complete",
      metadata: {
        provider: ocrResult.provider,
        confidence: ocrResult.confidence,
        items: ocrResult.items.length,
        fallback: Boolean(ocrError),
        append: Boolean(appendReceiptId),
      },
    });

    await supabase.from("activities").insert({
      user_id: user.id,
      receipt_id: receiptId,
      action: appendReceiptId ? "receipt_page_uploaded" : "receipt_uploaded",
      metadata: { merchant: ocrResult.merchant, append: Boolean(appendReceiptId) },
    });

    const { count: totalItemCount } = await supabase
      .from("receipt_items")
      .select("id", { count: "exact", head: true })
      .eq("receipt_id", receiptId);

    const { count: pageCount } = await supabase
      .from("receipt_images")
      .select("id", { count: "exact", head: true })
      .eq("receipt_id", receiptId);

    return created({
      id: receiptId,
      merchant: ocrResult.merchant,
      itemCount: ocrResult.items.length,
      totalItemCount: totalItemCount ?? ocrResult.items.length,
      pageCount: pageCount ?? 1,
      confidence: ocrResult.confidence,
      provider: ocrResult.provider,
      ocrFailed: Boolean(ocrError),
      ocrNotConfigured,
      warning: ocrError,
      appended: Boolean(appendReceiptId),
    });
  } catch (error) {
    console.error(error);
    return serverError(
      error instanceof Error ? error.message : "Upload failed"
    );
  }
}
