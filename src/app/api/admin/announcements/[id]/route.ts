import { z } from "zod";
import { getAdminClient, writeAuditLog } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ok,
  forbidden,
  serverError,
  fromZod,
  fail,
  notFound,
} from "@/lib/api";
import {
  announcementExcerpt,
  fanOutAnnouncementNotifications,
} from "@/lib/announcements";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  summary: z.string().trim().max(500).optional().nullable(),
  body: z.string().trim().min(1).max(20000).optional(),
  publish: z.boolean().optional(),
  unpublish: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await getAdminClient();
    if (!auth) return forbidden("Admin access required");
    const { supabase } = auth;

    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    const { data: existing, error: fetchError } = await supabase
      .from("announcements")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!existing) return notFound("Announcement not found");

    const updates: Record<string, unknown> = {};
    if (parsed.data.title != null) updates.title = parsed.data.title;
    if (parsed.data.body != null) {
      updates.body = parsed.data.body;
      if (parsed.data.summary === undefined) {
        updates.summary = announcementExcerpt(parsed.data.body, null, 280);
      }
    }
    if (parsed.data.summary !== undefined) updates.summary = parsed.data.summary;

    const wasPublished = Boolean(existing.is_published);
    let shouldNotify = false;

    if (parsed.data.publish) {
      updates.is_published = true;
      if (!wasPublished) {
        updates.published_at = new Date().toISOString();
        shouldNotify = true;
      }
    }

    if (parsed.data.unpublish) {
      updates.is_published = false;
      updates.published_at = null;
    }

    const { data: row, error } = await supabase
      .from("announcements")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error) return fail(error.message, 400);

    let notified = 0;
    if (shouldNotify && row) {
      const notifier = process.env.SUPABASE_SERVICE_ROLE_KEY
        ? createAdminClient()
        : supabase;
      notified = await fanOutAnnouncementNotifications(notifier, {
        id: row.id as string,
        title: row.title as string,
        summary: row.summary as string | null,
        body: row.body as string,
      });
    }

    await writeAuditLog(
      supabase,
      shouldNotify ? "announcement_published" : "announcement_updated",
      "announcement",
      id,
      { notified }
    );

    return ok({ ...row, notified });
  } catch (error) {
    console.error(error);
    return serverError("Failed to update announcement");
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await getAdminClient();
    if (!auth) return forbidden("Admin access required");
    const { supabase } = auth;

    const { error } = await supabase.from("announcements").delete().eq("id", id);
    if (error) return fail(error.message, 400);

    await writeAuditLog(supabase, "announcement_deleted", "announcement", id);
    return ok({ deleted: true });
  } catch (error) {
    console.error(error);
    return serverError("Failed to delete announcement");
  }
}
