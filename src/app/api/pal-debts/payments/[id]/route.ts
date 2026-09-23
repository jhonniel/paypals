import { z } from "zod";
import { getAuthedClient } from "@/lib/supabase/auth";
import { ok, unauthorized, fail, fromZod, serverError } from "@/lib/api";
import { deletePalPayment, updatePalPayment } from "@/lib/pal-debt-balance";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  amount: z.number().positive().max(999_999_999).optional(),
  note: z.string().max(500).nullable().optional(),
});

/** Update or delete a pal debt payment (creditor or debtor). */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;
    const { id } = await params;

    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    try {
      const result = await updatePalPayment(supabase, user.id, id, parsed.data);
      return ok({
        updated: true,
        open_remaining: result.openRemaining,
        credit_balance: result.creditBalance,
      });
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Could not update payment", 400);
    }
  } catch (e) {
    console.error(e);
    return serverError();
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;
    const { id } = await params;

    try {
      const result = await deletePalPayment(supabase, user.id, id);
      return ok({ deleted: true, open_remaining: result.openRemaining });
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Could not delete payment", 400);
    }
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
