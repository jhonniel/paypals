import { z } from "zod";
import { getAuthedClient } from "@/lib/supabase/auth";
import { created, unauthorized, fail, fromZod, serverError } from "@/lib/api";
import { applyPalReceivedPayment } from "@/lib/pal-debt-balance";

const creditorBodySchema = z.object({
  debtor_id: z.string().uuid(),
  amount: z.number().positive().max(999_999_999),
  currency: z.string().length(3).optional(),
  note: z.string().max(500).nullable().optional(),
});

const debtorBodySchema = z.object({
  creditor_id: z.string().uuid(),
  amount: z.number().positive().max(999_999_999),
  currency: z.string().length(3).optional(),
  note: z.string().max(500).nullable().optional(),
});

/** Record payment received (creditor) or paid (debtor on I owe tab). */
export async function POST(request: Request) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;

    const raw = await request.json();
    const asDebtor = debtorBodySchema.safeParse(raw);
    const asCreditor = creditorBodySchema.safeParse(raw);

    if (!asDebtor.success && !asCreditor.success) {
      return fromZod(asDebtor.success ? asCreditor.error! : asDebtor.error!);
    }

    let creditorId: string;
    let debtorId: string;
    let amount: number;
    let currency: string | undefined;
    let note: string | null | undefined;

    if (asDebtor.success) {
      creditorId = asDebtor.data.creditor_id;
      debtorId = user.id;
      amount = asDebtor.data.amount;
      currency = asDebtor.data.currency;
      note = asDebtor.data.note;
      if (creditorId === user.id) {
        return fail("You cannot record a payment to yourself", 400);
      }
      const { data: creditor, error: creditorErr } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", creditorId)
        .maybeSingle();
      if (creditorErr) return fail(creditorErr.message, 400);
      if (!creditor) return fail("User not found", 404);
    } else {
      creditorId = user.id;
      debtorId = asCreditor.data!.debtor_id;
      amount = asCreditor.data!.amount;
      currency = asCreditor.data!.currency;
      note = asCreditor.data!.note;
      if (debtorId === user.id) {
        return fail("You cannot record a payment from yourself", 400);
      }
      const { data: debtor, error: debtorErr } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", debtorId)
        .maybeSingle();
      if (debtorErr) return fail(debtorErr.message, 400);
      if (!debtor) return fail("User not found", 404);
    }

    try {
      const result = await applyPalReceivedPayment(
        supabase,
        creditorId,
        debtorId,
        amount,
        currency ?? "PHP",
        note ?? null
      );
      return created({
        payment: result.payment,
        open_remaining: result.openRemaining,
        credit_balance: result.creditBalance,
      });
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Could not record payment", 400);
    }
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
