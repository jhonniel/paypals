import { getAuthedClient } from "@/lib/supabase/auth";
import { ok, unauthorized, fail, serverError } from "@/lib/api";
import { deletePalReceivedPayment } from "@/lib/pal-debt-balance";

type Params = { params: Promise<{ id: string }> };

/** Delete a manual received payment and restore open lent balance. */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;
    const { id } = await params;

    try {
      const result = await deletePalReceivedPayment(supabase, user.id, id);
      return ok({ deleted: true, open_remaining: result.openRemaining });
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Could not delete payment", 400);
    }
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
