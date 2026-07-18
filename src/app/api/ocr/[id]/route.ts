import { getAuthedClient } from "@/lib/supabase/auth";
import { getOcrService } from "@/services/ocr";
import { DemoOcrProvider } from "@/services/ocr/providers/demo";
import { computeReceiptTotals, moneyNumber } from "@/lib/money";
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
    let ocrError: string | null = null;
    try {
      ocrResult = await getOcrService(preferred).extract({
        buffer,
        mimeType: image.mime_type || "image/jpeg",
        fileName: image.storage_path.split("/").pop(),
      });
    } catch (err) {
      ocrError = err instanceof Error ? err.message : "OCR failed";
      ocrResult = await new DemoOcrProvider().extract({
        buffer,
        mimeType: image.mime_type || "image/jpeg",
      });
    }

    const duration = Date.now() - started;

    await supabase.from("ocr_logs").insert({
      receipt_id: id,
      provider: ocrResult.provider,
      status: ocrError ? "fallback_success" : "success",
      request_meta: { reprocess: true },
      response_meta: { itemCount: ocrResult.items.length },
      confidence: ocrResult.confidence,
      error_message: ocrError,
      duration_ms: duration,
    });

    await supabase.from("receipt_items").delete().eq("receipt_id", id);

    if (ocrResult.items.length > 0) {
      await supabase.from("receipt_items").insert(
        ocrResult.items.map((item, index) => ({
          receipt_id: id,
          name: item.name,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          total_price: item.totalPrice,
          sort_order: index,
        }))
      );
    }

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

    const { data: updated, error } = await supabase
      .from("receipts")
      .update({
        merchant: ocrResult.merchant,
        subtotal: totals.itemsSubtotal,
        tax: totals.tax,
        discount: totals.discount,
        service_charge: totals.serviceCharge,
        tip: totals.tip,
        total:
          ocrResult.total !== null ? moneyNumber(ocrResult.total) : totals.total,
        status: "ocr_complete",
        ocr_confidence: ocrResult.confidence,
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error) return fail(error.message, 400);

    await supabase.from("receipt_history").insert({
      receipt_id: id,
      user_id: user.id,
      event: "ocr_complete",
      metadata: { reprocess: true, provider: ocrResult.provider },
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
      provider: ocrResult.provider,
    });
  } catch (error) {
    console.error(error);
    return serverError();
  }
}
