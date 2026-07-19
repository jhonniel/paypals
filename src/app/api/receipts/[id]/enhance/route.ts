import { getAuthedClient } from "@/lib/supabase/auth";
import { preprocessReceiptImage } from "@/services/ocr/preprocess-image";
import { unauthorized, notFound, fail, serverError } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const maxDuration = 30;

/** Returns an OpenCV-style enhanced PNG of the receipt (for preview / debugging). */
export async function GET(_request: Request, { params }: Params) {
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
    if (!image?.storage_path) return fail("No receipt image");

    const { data: fileData, error } = await supabase.storage
      .from("receipts")
      .download(image.storage_path);

    if (error || !fileData) {
      return fail(error?.message ?? "Failed to download image");
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());
    const enhanced = await preprocessReceiptImage(
      buffer,
      image.mime_type || "image/jpeg"
    );

    return new Response(new Uint8Array(enhanced.buffer), {
      status: 200,
      headers: {
        "Content-Type": enhanced.mimeType,
        "Cache-Control": "private, max-age=120",
        "X-Paypals-Enhanced": enhanced.enhanced ? "1" : "0",
        "X-Paypals-Steps": enhanced.steps.join(","),
      },
    });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
