import { getAuthedClient } from "@/lib/supabase/auth";
import { getActiveOcrProviderName, getOcrConfigurationError } from "@/services/ocr";
import {
  emptyOcrResult,
  extractWithPreprocess,
} from "@/services/ocr/extract-with-preprocess";
import { computeReceiptTotals, moneyNumber } from "@/lib/money";
import { tryReceiptDate, tryReceiptTime } from "@/lib/receipt-datetime";
import { ok, unauthorized, notFound, fail, serverError } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(_request: Request, { params }: Params) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;
    const { id } = await params;

    const { data: receipt } = await supabase
      .from("receipts")
      .select("id")
      .eq("id", id)
      .eq("created_by", user.id)
      .maybeSingle();

    if (!receipt) return notFound("Receipt not found");

    const { data: images } = await supabase
      .from("receipt_images")
      .select("storage_path, mime_type")
      .eq("receipt_id", id)
      .order("created_at", { ascending: true })
      .limit(1);

    const image = images?.[0];
    if (!image?.storage_path) return fail("No receipt image to OCR");

    const { data: fileData, error: downloadError } = await supabase.storage
      .from("receipts")
      .download(image.storage_path);

    if (downloadError || !fileData) {
      return fail(downloadError?.message ?? "Failed to download image");
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());
    const started = Date.now();

    const { data: userSettings } = await supabase
      .from("user_settings")
      .select("ocr_provider")
      .eq("user_id", user.id)
      .maybeSingle();

    const preferred =
      userSettings?.ocr_provider === "ocrspace" ||
      userSettings?.ocr_provider === "google" ||
      userSettings?.ocr_provider === "tesseract" ||
      userSettings?.ocr_provider === "openai"
        ? userSettings.ocr_provider
        : undefined;

    let ocrResult;
    let ocrError: string | null = getOcrConfigurationError(preferred);
    let ocrNotConfigured = Boolean(ocrError);
    let preprocessMeta = null;

    if (!ocrError) {
      try {
        const ran = await extractWithPreprocess(
          buffer,
          image.mime_type || "image/jpeg",
          image.storage_path.split("/").pop(),
          preferred
        );
        ocrResult = ran.result;
        preprocessMeta = ran.meta;
        if (!ocrResult.items.length && ocrResult.total == null) {
          throw new Error("No line items found on receipt");
        }
      } catch (err) {
        ocrError = err instanceof Error ? err.message : "OCR failed";
        console.error("[re-OCR]", ocrError);
        ocrResult = emptyOcrResult(preferred ?? getActiveOcrProviderName(), ocrError);
      }
    } else {
      console.warn("[re-OCR]", ocrError);
      ocrResult = emptyOcrResult(preferred ?? getActiveOcrProviderName(), ocrError);
      preprocessMeta = {
        preprocessSteps: ["not_configured"],
        enhanced: false,
        usedBinaryPass: false,
      };
    }

    const duration = Date.now() - started;

    await supabase.from("ocr_logs").insert({
      receipt_id: id,
      provider: ocrResult.provider,
      status: ocrError ? "ocr_failed" : "success",
      request_meta: { reprocess: true, preprocess: preprocessMeta },
      response_meta: { itemCount: ocrResult.items.length },
      confidence: ocrResult.confidence,
      error_message: ocrError,
      duration_ms: duration,
    });

    await supabase.from("receipt_items").delete().eq("receipt_id", id);

    if (ocrResult.items.length > 0) {
      const { insertReceiptItems } = await import("@/lib/insert-receipt-items");
      const { error: itemsError } = await insertReceiptItems(
        supabase,
        id,
        ocrResult.items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          subItems: item.subItems,
        }))
      );
      if (itemsError) return fail(itemsError, 400);
    }

    const ocrDiscountRows =
      ocrResult.discountLines ??
      (ocrResult.discount != null && ocrResult.discount > 0
        ? [{ label: "Discount", amount: ocrResult.discount }]
        : []);
    if (ocrDiscountRows.length > 0) {
      const { insertReceiptDiscounts } = await import("@/lib/receipt-discounts");
      await insertReceiptDiscounts(supabase, id, ocrDiscountRows);
    }

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

    const { data: updated, error } = await supabase
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
        total:
          ocrResult.total !== null ? moneyNumber(ocrResult.total) : totals.total,
        status: "ocr_complete",
        ocr_confidence: ocrResult.confidence,
        notes: ocrError
          ? ocrNotConfigured
            ? `${ocrError} Restart the dev server after updating .env.local.`
            : `OCR could not read this receipt (${ocrError}). Add items manually or tap Re-run OCR.`
          : null,
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error) return fail(error.message, 400);

    await supabase.from("receipt_history").insert({
      receipt_id: id,
      user_id: user.id,
      event: "ocr_complete",
      metadata: {
        reprocess: true,
        provider: ocrResult.provider,
        failed: Boolean(ocrError),
      },
    });

    const { data: items } = await supabase
      .from("receipt_items")
      .select("*")
      .eq("receipt_id", id)
      .order("sort_order", { ascending: true });

    return ok({
      receipt: updated,
      items: items ?? [],
      warning: ocrError,
      ocrNotConfigured,
      provider: ocrResult.provider,
      ocrFailed: Boolean(ocrError),
    });
  } catch (error) {
    console.error(error);
    return serverError();
  }
}
