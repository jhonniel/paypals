import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedClient } from "@/lib/supabase/auth";
import { ok, unauthorized, fail, fromZod, serverError, notFound } from "@/lib/api";
import { applyPalDebtorCredit } from "@/lib/pal-debt-balance";

const schema = z.object({
  token: z.string().min(8).max(64),
});

/** Preview pal-debt invite by token. */
export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token")?.trim() ?? "";
    if (token.length < 8) return fail("Invalid invite");

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_pal_debt_invite", {
      p_token: token,
    });

    if (error) return fail(error.message, 400);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || row.claimed) return notFound("Invite not found or already claimed");

    return ok({
      debtId: row.debt_id,
      inviteKind: row.invite_kind as "debtor_claim" | "creditor_claim",
      pendingName: row.pending_name,
      pendingEmail: row.pending_email,
      amount: Number(row.amount),
      currency: row.currency,
      description: row.description,
      counterpartyName: row.counterparty_name,
    });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}

/** Claim pal debt after signup / login. */
export async function POST(request: Request) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    const preview = await auth.supabase.rpc("get_pal_debt_invite", {
      p_token: parsed.data.token,
    });
    const previewRow = Array.isArray(preview.data) ? preview.data[0] : preview.data;
    const inviteKind = previewRow?.invite_kind as string | undefined;

    const { data: debtId, error } = await auth.supabase.rpc(
      "claim_pal_debt_invite",
      { p_token: parsed.data.token }
    );

    if (error) return fail(error.message, 400);

    const { data: debt } = await auth.supabase
      .from("pal_debts")
      .select("creditor_id, debtor_id, amount, currency, description")
      .eq("id", debtId)
      .maybeSingle();

    if (debt?.creditor_id && debt.debtor_id) {
      try {
        await applyPalDebtorCredit(
          auth.supabase,
          debt.creditor_id as string,
          debt.debtor_id as string
        );
      } catch (e) {
        console.error("applyPalDebtorCredit after pal debt claim", e);
      }

      const amountLabel = new Intl.NumberFormat("en-PH", {
        style: "currency",
        currency: (debt.currency as string) || "PHP",
      }).format(Number(debt.amount));

      if (inviteKind === "creditor_claim") {
        const { data: debtor } = await auth.supabase
          .from("profiles")
          .select("full_name, username")
          .eq("id", debt.debtor_id)
          .maybeSingle();

        const debtorName =
          debtor?.full_name?.trim() ||
          (debtor?.username ? `@${debtor.username}` : null) ||
          previewRow?.pending_name ||
          "Someone";

        await auth.supabase.from("notifications").insert({
          user_id: auth.user.id,
          type: "payment_reminder",
          title: `${debtorName} owes you`,
          body: `${debtorName} recorded that they owe you ${amountLabel}${
            debt.description ? ` — ${debt.description}` : ""
          }.`,
          link: "/pal-owes-me",
        });
      } else {
        const { data: creditor } = await auth.supabase
          .from("profiles")
          .select("full_name, username")
          .eq("id", debt.creditor_id)
          .maybeSingle();

        const creditorName =
          creditor?.full_name?.trim() ||
          (creditor?.username ? `@${creditor.username}` : null) ||
          "Someone";

        await auth.supabase.from("notifications").insert({
          user_id: auth.user.id,
          type: "payment_reminder",
          title: `${creditorName} recorded a debt`,
          body: `${creditorName} says you owe ${amountLabel}${
            debt.description ? ` — ${debt.description}` : ""
          }.`,
          link: "/pal-owes-me",
        });
      }
    }

    return ok({ debt_id: debtId, invite_kind: inviteKind ?? null });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
