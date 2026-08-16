import { z } from "zod";
import { getAdminClient, writeAuditLog } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ok,
  created,
  forbidden,
  serverError,
  fromZod,
  fail,
} from "@/lib/api";
import {
  announcementExcerpt,
  fanOutAnnouncementNotifications,
} from "@/lib/announcements";

export async function GET() {
  try {
    const auth = await getAdminClient();
    if (!auth) return forbidden("Admin access required");
    const { supabase } = auth;

    const { data, error } = await supabase
      .from("announcements")
      .select(
        "id, title, summary, body, is_published, published_at, created_at, updated_at, created_by"
      )
      .order("created_at", { ascending: false });

    if (error) throw error;
    return ok(data ?? []);
  } catch (error) {
    console.error(error);
    return serverError("Failed to load announcements");
  }
}

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(500).optional().nullable(),
  body: z.string().trim().min(1).max(20000),
  publish: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const auth = await getAdminClient();
    if (!auth) return forbidden("Admin access required");
    const { supabase, user } = auth;

    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    const { title, body, publish } = parsed.data;
    const summary =
      parsed.data.summary?.trim() ||
      announcementExcerpt(body, null, 280);

    const now = new Date().toISOString();
    const isPublished = Boolean(publish);

    const { data: row, error } = await supabase
      .from("announcements")
      .insert({
        title,
        summary,
        body,
        created_by: user.id,
        is_published: isPublished,
        published_at: isPublished ? now : null,
      })
      .select("*")
      .single();

    if (error) return fail(error.message, 400);

    let notified = 0;
    if (isPublished && row) {
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
      isPublished ? "announcement_published" : "announcement_created",
      "announcement",
      row.id as string,
      { title, notified }
    );

    return created({ ...row, notified });
  } catch (error) {
    console.error(error);
    return serverError("Failed to create announcement");
  }
}
