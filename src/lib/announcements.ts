import type { SupabaseClient } from "@supabase/supabase-js";

export type AnnouncementRow = {
  id: string;
  title: string;
  summary: string | null;
  body: string;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export function announcementLink(id: string) {
  return `/announcements/${id}`;
}

export function announcementIdFromLink(link: string | null | undefined): string | null {
  if (!link) return null;
  const match = link.match(/\/announcements\/([0-9a-f-]{36})/i);
  return match?.[1] ?? null;
}

export function announcementExcerpt(body: string, summary?: string | null, max = 200) {
  const text = (summary ?? body).trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

/** Notify every profile about a published announcement. */
export async function fanOutAnnouncementNotifications(
  supabase: SupabaseClient,
  announcement: Pick<AnnouncementRow, "id" | "title" | "summary" | "body">
) {
  const { data: profiles, error } = await supabase.from("profiles").select("id");
  if (error) throw error;
  if (!profiles?.length) return 0;

  const excerpt = announcementExcerpt(announcement.body, announcement.summary);
  const link = announcementLink(announcement.id);
  const rows = profiles.map((p) => ({
    user_id: p.id as string,
    type: "announcement" as const,
    title: announcement.title,
    body: excerpt,
    link,
  }));

  const chunkSize = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error: insertError } = await supabase.from("notifications").insert(chunk);
    if (insertError) throw insertError;
    inserted += chunk.length;
  }

  return inserted;
}
