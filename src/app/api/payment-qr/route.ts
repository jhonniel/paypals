import { getAuthedClient } from "@/lib/supabase/auth";
import { created, fail, unauthorized, serverError } from "@/lib/api";
import { normalizePaymentMethods } from "@/lib/payment-methods";

export const runtime = "nodejs";

const ALLOWED = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);
const MAX_BYTES = 5 * 1024 * 1024;

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
    const accountIdRaw = form.get("account_id");
    if (!(file instanceof File)) return fail("Missing file field");

    const accountId =
      typeof accountIdRaw === "string" && accountIdRaw.trim()
        ? accountIdRaw.trim()
        : crypto.randomUUID();

    const mime = normalizeMime(file.type, file.name);
    if (!ALLOWED.has(mime)) {
      return fail("QR must be a PNG, JPEG, WebP, or GIF image");
    }
    if (file.size > MAX_BYTES) return fail("QR image too large (max 5MB)");

    const ext =
      file.name.split(".").pop()?.toLowerCase() ||
      (mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg");
    const storagePath = `${user.id}/${accountId}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    // Remove any previous QR files for this account slot
    const { data: existing } = await supabase.storage
      .from("payment-qr")
      .list(user.id, { limit: 100 });
    const stale = (existing ?? [])
      .filter((f) => f.name.startsWith(`${accountId}.`))
      .map((f) => `${user.id}/${f.name}`);
    if (stale.length) {
      await supabase.storage.from("payment-qr").remove(stale);
    }

    const { error: uploadError } = await supabase.storage
      .from("payment-qr")
      .upload(storagePath, buffer, {
        contentType: mime,
        upsert: true,
      });

    if (uploadError) {
      return fail(`QR upload failed: ${uploadError.message}`, 400);
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("payment-qr").getPublicUrl(storagePath);

    // Persist URL on the matching payout account when it already exists
    const { data: profile } = await supabase
      .from("profiles")
      .select("payment_methods")
      .eq("id", user.id)
      .maybeSingle();
    const methods = normalizePaymentMethods(profile?.payment_methods);
    if (methods.some((m) => m.id === accountId)) {
      const next = methods.map((m) =>
        m.id === accountId ? { ...m, qr_code_url: publicUrl } : m
      );
      await supabase
        .from("profiles")
        .update({ payment_methods: next })
        .eq("id", user.id);
    }

    return created({
      account_id: accountId,
      path: storagePath,
      url: `${publicUrl}?t=${Date.now()}`,
    });
  } catch (error) {
    console.error(error);
    return serverError(error instanceof Error ? error.message : "Upload failed");
  }
}
