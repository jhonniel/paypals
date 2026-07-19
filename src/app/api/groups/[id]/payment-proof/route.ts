import { getAuthedClient } from "@/lib/supabase/auth";
import {
  fail,
  unauthorized,
  notFound,
  serverError,
  ok,
} from "@/lib/api";
import { moneyNumber } from "@/lib/money";
import { getMemberGroupPayTotal } from "@/lib/group-member-payments";
import { amountsMatch, todayInManila } from "@/lib/payment-proof";
import { extractPaymentProofFields } from "@/services/ocr/extract-payment-proof";

export const runtime = "nodejs";
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

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

export async function POST(request: Request, { params }: Params) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;
    const { id: groupId } = await params;

    const { data: membership } = await supabase
      .from("group_members")
      .select("id, role")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) return fail("You are not a member of this group", 403);

    const pay = await getMemberGroupPayTotal(supabase, groupId, membership.id);
    if (!pay) return notFound("Member not found");
    if (pay.total <= 0) {
      return fail("You have nothing to pay in this group");
    }

    const form = await request.formData();
    const fileEntry = form.get("file");
    if (!isUploadBlob(fileEntry)) return fail("Missing proof image");
    const file = fileEntry as Blob;
    const fileName =
      file instanceof File && file.name
        ? file.name
        : `payment-proof-${Date.now()}.jpg`;
    const mime = normalizeMime(file.type, fileName);
    if (!ALLOWED.has(mime)) {
      return fail("Proof must be a PNG, JPEG, WebP, or GIF image");
    }
    if (file.size > MAX_BYTES) return fail("Proof image too large (max 10MB)");

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext =
      fileName.split(".").pop()?.toLowerCase() ||
      (mime === "image/png" ? "png" : "jpg");
    const storagePath = `${user.id}/${groupId}/${membership.id}.${ext}`;

    let ocrAmount: number | null = null;
    let ocrDate: string | null = null;
    let ocrMeta: Record<string, unknown> = {};

    try {
      const fields = await extractPaymentProofFields(buffer, mime, fileName);
      ocrAmount = fields.amount;
      ocrDate = fields.date;
      ocrMeta = {
        provider: fields.provider,
        textPreview: fields.text.slice(0, 500),
        raw: fields.raw,
      };
    } catch (err) {
      ocrMeta = {
        error: err instanceof Error ? err.message : "OCR failed",
      };
    }

    const today = todayInManila();
    const expected = moneyNumber(pay.total);
    const reasons: string[] = [];

    if (ocrAmount == null) {
      reasons.push("Could not read the payment amount from the screenshot");
    } else if (!amountsMatch(expected, ocrAmount)) {
      reasons.push(
        `Amount ₱${moneyNumber(ocrAmount).toFixed(2)} does not match what you owe (₱${expected.toFixed(2)})`
      );
    }

    if (!ocrDate) {
      reasons.push("Could not read the payment date from the screenshot");
    } else if (ocrDate !== today) {
      reasons.push(
        `Payment date (${ocrDate}) must be today’s date in Asia/Manila (${today})`
      );
    }

    const accepted = reasons.length === 0;
    const status = accepted ? "paid" : "rejected";

    const { data: existingFiles } = await supabase.storage
      .from("payment-proofs")
      .list(`${user.id}/${groupId}`, { limit: 20 });
    const stale = (existingFiles ?? [])
      .filter((f) => f.name.startsWith(`${membership.id}.`))
      .map((f) => `${user.id}/${groupId}/${f.name}`);
    if (stale.length) {
      await supabase.storage.from("payment-proofs").remove(stale);
    }

    const { error: uploadError } = await supabase.storage
      .from("payment-proofs")
      .upload(storagePath, buffer, {
        contentType: mime,
        upsert: true,
      });
    if (uploadError) {
      return fail(
        `Proof upload failed: ${uploadError.message}. Run migration 020 if the payment-proofs bucket is missing.`,
        400
      );
    }

    const { data: receipts } = await supabase
      .from("receipts")
      .select("paid_by_member_id")
      .eq("group_id", groupId)
      .not("paid_by_member_id", "is", null)
      .limit(20);
    let toMemberId =
      receipts?.find((r) => r.paid_by_member_id)?.paid_by_member_id ?? null;
    if (!toMemberId) {
      const { data: owner } = await supabase
        .from("group_members")
        .select("id")
        .eq("group_id", groupId)
        .eq("role", "owner")
        .maybeSingle();
      toMemberId = owner?.id ?? null;
    }

    const row = {
      group_id: groupId,
      from_member_id: membership.id,
      to_member_id: toMemberId,
      expected_amount: expected,
      ocr_amount: ocrAmount,
      ocr_date: ocrDate,
      currency: pay.currency || "PHP",
      status,
      proof_storage_path: storagePath,
      proof_mime: mime,
      rejection_reason: accepted ? null : reasons.join(". "),
      ocr_raw: ocrMeta,
      validated_at: accepted ? new Date().toISOString() : null,
    };

    const { data: saved, error: saveError } = await supabase
      .from("group_payment_proofs")
      .upsert(row, { onConflict: "group_id,from_member_id" })
      .select("*")
      .maybeSingle();

    if (saveError) {
      return fail(
        `Could not save proof: ${saveError.message}. Run migration 020_group_payment_proofs.sql if the table is missing.`,
        400
      );
    }

    if (!accepted) {
      return fail(reasons.join(". "), 422, "PAYMENT_PROOF_REJECTED", {
        expected_amount: expected,
        ocr_amount: ocrAmount,
        ocr_date: ocrDate,
        today,
        proof: saved,
      });
    }

    return ok({
      status: "paid",
      expected_amount: expected,
      ocr_amount: ocrAmount,
      ocr_date: ocrDate,
      proof: saved,
    });
  } catch (error) {
    console.error(error);
    return serverError(
      error instanceof Error ? error.message : "Payment proof failed"
    );
  }
}
