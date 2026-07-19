import { getAuthedClient } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { unauthorized, notFound, fail, serverError } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/**
 * Stream the original receipt image for any user who can access the receipt
 * (uploader or group member).
 *
 * Access is checked via receipts RLS (can_access_receipt). Download prefers
 * the service-role client so members work even before storage policy 010 is
 * applied; falls back to the user client when the service key is unset.
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase } = auth;
    const { id } = await params;

    // RLS: creator or group member only
    const { data: receipt } = await supabase
      .from("receipts")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (!receipt) return notFound("Receipt not found");

    const { data: images } = await supabase
      .from("receipt_images")
      .select("storage_path, mime_type")
      .eq("receipt_id", id)
      .order("created_at", { ascending: true })
      .limit(1);

    const image = images?.[0];
    if (!image?.storage_path) return fail("No receipt image", 404);

    let fileData: Blob | null = null;
    let lastError: string | null = null;

    // Prefer service role after access check — members' storage RLS may still
    // be "own folder only" until migration 010 is applied.
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const admin = createAdminClient();
        const { data: adminDownload, error: adminError } = await admin.storage
          .from("receipts")
          .download(image.storage_path);
        if (!adminError && adminDownload) {
          fileData = adminDownload;
        } else {
          lastError = adminError?.message ?? "Admin download failed";
        }
      } catch (e) {
        lastError = e instanceof Error ? e.message : "Admin client failed";
      }
    }

    if (!fileData) {
      const { data: ownDownload, error: ownError } = await supabase.storage
        .from("receipts")
        .download(image.storage_path);
      if (!ownError && ownDownload) {
        fileData = ownDownload;
      } else {
        lastError = ownError?.message ?? lastError ?? "Download failed";
      }
    }

    if (!fileData) {
      console.error("[receipt image]", id, lastError);
      return fail(
        lastError ??
          "Failed to load image — apply migration 010 or set SUPABASE_SERVICE_ROLE_KEY",
        403
      );
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": image.mime_type || "image/jpeg",
        "Cache-Control": "private, max-age=120",
      },
    });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
