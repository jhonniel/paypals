import { z } from "zod";
import { getAuthedClient } from "@/lib/supabase/auth";
import { created, unauthorized, fail, fromZod, serverError } from "@/lib/api";
import { applyPalDebtorCredit } from "@/lib/pal-debt-balance";

const createOweSchema = z
  .object({
    creditor_id: z.string().uuid().optional(),
    pending_creditor_name: z.string().trim().min(1).max(120).optional(),
    pending_creditor_email: z.string().email().max(255).optional().nullable(),
    amount: z.number().positive().max(999_999_999),
    currency: z.string().length(3).optional(),
    description: z.string().max(500).nullable().optional(),
  })
  .refine(
    (data) =>
      (Boolean(data.creditor_id) && !data.pending_creditor_name) ||
      (Boolean(data.pending_creditor_name) && !data.creditor_id),
    { message: "Provide creditor_id or pending_creditor_name, not both" }
  );

const pendingFields =
  "pending_creditor_name, pending_creditor_email, pending_debtor_name, pending_debtor_email, invite_token, claimed_at";

const debtSelectDebtorWithReceived = `id, creditor_id, debtor_id, amount, amount_received, currency, description, status, created_at, updated_at, settled_at, ${pendingFields}, creditor:creditor_id(id, full_name, username, avatar_url, email, payment_methods)`;

/** Debtor records what they owe someone (I owe pals). */
export async function POST(request: Request) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;

    const parsed = createOweSchema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    const {
      creditor_id,
      pending_creditor_name,
      pending_creditor_email,
      amount,
      currency,
      description,
    } = parsed.data;

    const isPendingInvite = Boolean(pending_creditor_name);
    if (creditor_id === user.id) {
      return fail("You cannot record a debt to yourself", 400);
    }

    if (!isPendingInvite && creditor_id) {
      const { data: creditor, error: creditorErr } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", creditor_id)
        .maybeSingle();

      if (creditorErr) return fail(creditorErr.message, 400);
      if (!creditor) return fail("User not found", 404);
    }

    const inviteToken = isPendingInvite
      ? crypto.randomUUID().replace(/-/g, "")
      : null;

    const insertRow = {
      creditor_id: isPendingInvite ? null : creditor_id!,
      debtor_id: user.id,
      pending_creditor_name: isPendingInvite ? pending_creditor_name!.trim() : null,
      pending_creditor_email: isPendingInvite
        ? pending_creditor_email?.trim() || null
        : null,
      invite_token: inviteToken,
      amount,
      amount_received: 0,
      currency: (currency ?? "PHP").toUpperCase(),
      description: description?.trim() || null,
      status: "open" as const,
      settled_at: null,
    };

    const { data, error } = await supabase
      .from("pal_debts")
      .insert(insertRow)
      .select(debtSelectDebtorWithReceived)
      .single();

    if (
      error &&
      /amount_received|pending_creditor_name|invite_token|column/i.test(error.message)
    ) {
      return fail(
        "Pending creditor debts require database migration 038_pal_debt_creditor_invite.sql",
        400
      );
    }

    if (error) return fail(error.message, 400);

    if (!isPendingInvite && creditor_id) {
      try {
        await applyPalDebtorCredit(supabase, creditor_id, user.id);
      } catch (e) {
        console.error("applyPalDebtorCredit after owe insert", e);
      }
    }

    const row = {
      ...data,
      amount_received:
        data.amount_received != null ? Number(data.amount_received) : 0,
    };

    return created({
      ...row,
      ...(inviteToken ? { invite_token: inviteToken } : {}),
    });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
