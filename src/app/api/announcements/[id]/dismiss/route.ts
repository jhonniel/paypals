import { createClient } from "@/lib/supabase/server";
import { ok, unauthorized, serverError } from "@/lib/api";

/** Dismiss the global announcement modal for this user. */
export async function POST(
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

    const { error } = await supabase.from("announcement_dismissals").upsert(
      {
        user_id: user.id,
        announcement_id: id,
        dismissed_at: new Date().toISOString(),
      },
      { onConflict: "user_id,announcement_id" }
    );

    if (error) throw error;
    return ok({ dismissed: true });
  } catch (error) {
    console.error(error);
    return serverError("Failed to dismiss announcement");
  }
}
