import { getAuthedClient } from "@/lib/supabase/auth";
import { ok, unauthorized, serverError } from "@/lib/api";

export async function GET() {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;

    let receiptBytes = 0;
    let avatarBytes = 0;
    let ocrBytes = 0;
    let paymentQrBytes = 0;
    let fileCount = 0;

    for (const bucket of [
      { name: "receipts" as const, target: "receipt" },
      { name: "avatars" as const, target: "avatar" },
      { name: "ocr-json" as const, target: "ocr" },
      { name: "payment-qr" as const, target: "paymentQr" },
    ]) {
      const { data: files, error } = await supabase.storage
        .from(bucket.name)
        .list(user.id, { limit: 1000 });

      if (error) {
        // folder may not exist yet
        continue;
      }

      for (const f of files ?? []) {
        const size = (f.metadata as { size?: number } | null)?.size ?? 0;
        fileCount += 1;
        if (bucket.target === "receipt") receiptBytes += size;
        if (bucket.target === "avatar") avatarBytes += size;
        if (bucket.target === "ocr") ocrBytes += size;
        if (bucket.target === "paymentQr") paymentQrBytes += size;
      }
    }

    const { count: receiptCount } = await supabase
      .from("receipts")
      .select("id", { count: "exact", head: true })
      .eq("created_by", user.id);

    const { data: settings } = await supabase
      .from("user_settings")
      .select("ocr_provider")
      .eq("user_id", user.id)
      .maybeSingle();

    return ok({
      storage: {
        receiptBytes,
        avatarBytes,
        ocrBytes,
        paymentQrBytes,
        totalBytes: receiptBytes + avatarBytes + ocrBytes + paymentQrBytes,
        fileCount,
        receiptCount: receiptCount ?? 0,
      },
      ocr_provider: settings?.ocr_provider ?? null,
    });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
