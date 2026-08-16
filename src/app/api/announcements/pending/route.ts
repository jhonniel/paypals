import { createClient } from "@/lib/supabase/server";
import { ok, unauthorized, serverError } from "@/lib/api";
import { announcementExcerpt } from "@/lib/announcements";

/** Published announcements the user has not dismissed from the global modal. */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return unauthorized();

    const { data: published, error } = await supabase
      .from("announcements")
      .select("id, title, summary, body, published_at, created_at")
      .eq("is_published", true)
      .order("published_at", { ascending: false });

    if (error) throw error;

    const { data: dismissals } = await supabase
      .from("announcement_dismissals")
      .select("announcement_id")
      .eq("user_id", user.id);

    const dismissed = new Set(
      (dismissals ?? []).map((d) => d.announcement_id as string)
    );

    const pending = (published ?? [])
      .filter((a) => !dismissed.has(a.id as string))
      .map((a) => ({
        id: a.id as string,
        title: a.title as string,
        summary: (a.summary as string | null) ?? announcementExcerpt(a.body as string),
        body: a.body as string,
        published_at: a.published_at as string | null,
        created_at: a.created_at as string,
      }));

    return ok(pending);
  } catch (error) {
    console.error(error);
    return serverError("Failed to load announcements");
  }
}
