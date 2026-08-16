import { createClient } from "@/lib/supabase/server";
import { ok, unauthorized, notFound, serverError } from "@/lib/api";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return unauthorized();

    const { data, error } = await supabase
      .from("announcements")
      .select("id, title, summary, body, published_at, created_at")
      .eq("id", id)
      .eq("is_published", true)
      .maybeSingle();

    if (error) throw error;
    if (!data) return notFound("Announcement not found");

    return ok(data);
  } catch (error) {
    console.error(error);
    return serverError("Failed to load announcement");
  }
}
