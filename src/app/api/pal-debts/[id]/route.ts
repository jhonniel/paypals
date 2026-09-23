import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getAuthedClient } from "@/lib/supabase/auth";
import { ok, unauthorized, notFound, fail, fromZod, serverError } from "@/lib/api";
import {
  applyPalReceivedPayment,
  palDebtRemaining,
  recalculatePalDebtorAllocations,
} from "@/lib/pal-debt-balance";
import { restoreGroupMemberFromPalDebt } from "@/lib/move-group-to-pal-debt";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  status: z.enum(["open", "paid", "cancelled"]).optional(),
  amount: z.number().positive().max(999_999_999).optional(),
  description: z.string().max(500).nullable().optional(),
});

const debtSelect =
  "id, creditor_id, debtor_id, amount, amount_received, currency, description, status, created_at, updated_at, settled_at, debtor:debtor_id(id, full_name, username, avatar_url, email), creditor:creditor_id(id, full_name, username, avatar_url, email)";

async function loadOwnedDebt(
  supabase: SupabaseClient,
  userId: string,
  debtId: string
) {
  const { data: asCreditor, error: creditorErr } = await supabase
    .from("pal_debts")
    .select("id, creditor_id, debtor_id, amount, amount_received, currency, status, description")
    .eq("id", debtId)
    .eq("creditor_id", userId)
    .maybeSingle();

  if (creditorErr) throw new Error(creditorErr.message);
  if (asCreditor) return { debt: asCreditor, role: "creditor" as const };

  const { data: asDebtor, error: debtorErr } = await supabase
    .from("pal_debts")
    .select("id, creditor_id, debtor_id, amount, amount_received, currency, status, description")
    .eq("id", debtId)
    .eq("debtor_id", userId)
    .maybeSingle();

  if (debtorErr) throw new Error(debtorErr.message);
  if (asDebtor) return { debt: asDebtor, role: "debtor" as const };

  return null;
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;
    const { id } = await params;

    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    const owned = await loadOwnedDebt(supabase, user.id, id);
    if (!owned) return notFound("Record not found");

    if (parsed.data.status === "paid") {
      if (owned.role !== "creditor") {
        return fail("Only the lender can mark this as paid from here", 400);
      }
      const existing = owned.debt;
      if (existing.status === "paid") {
        return fail("Already marked as paid", 400);
      }
      if (!existing.debtor_id) {
        return fail("Use Received to record payment for manual pals", 400);
      }

      const remaining = palDebtRemaining(existing);
      if (remaining <= 0) return fail("Nothing left to mark paid", 400);

      try {
        await applyPalReceivedPayment(
          supabase,
          user.id,
          existing.debtor_id as string,
          remaining,
          (existing.currency as string) ?? "PHP",
          "Marked as paid",
          { debtId: id }
        );
      } catch (e) {
        return fail(e instanceof Error ? e.message : "Could not mark paid", 400);
      }

      const { data, error } = await supabase
        .from("pal_debts")
        .select(debtSelect)
        .eq("id", id)
        .maybeSingle();

      if (error) return fail(error.message, 400);
      if (!data) return notFound("Record not found");
      return ok(data);
    }

    const patch: Record<string, unknown> = {};
    if (parsed.data.description !== undefined) {
      patch.description = parsed.data.description?.trim() || null;
    }
    if (parsed.data.amount !== undefined) {
      const received = Number(owned.debt.amount_received ?? 0);
      if (parsed.data.amount < received) {
        return fail("Amount cannot be less than what is already paid", 400);
      }
      patch.amount = parsed.data.amount;
      if (received >= parsed.data.amount) {
        patch.status = "paid";
        patch.settled_at = new Date().toISOString();
      } else if (owned.debt.status === "paid") {
        patch.status = "open";
        patch.settled_at = null;
      }
    }
    if (parsed.data.status === "open") {
      patch.settled_at = null;
      patch.amount_received = 0;
      patch.status = "open";
    }
    if (parsed.data.status === "cancelled") {
      patch.status = "cancelled";
    }

    if (Object.keys(patch).length === 0) {
      return fail("Nothing to update", 400);
    }

    let updateQuery = supabase.from("pal_debts").update(patch).eq("id", id);
    updateQuery =
      owned.role === "creditor"
        ? updateQuery.eq("creditor_id", user.id)
        : updateQuery.eq("debtor_id", user.id);

    const { data, error } = await updateQuery.select(debtSelect).maybeSingle();

    if (error) return fail(error.message, 400);
    if (!data) return notFound("Record not found");
    return ok(data);
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

    let { data: existing, error: loadErr } = await supabase
      .from("pal_debts")
      .select("id, debtor_id, creditor_id, source_group_id, source_member_id")
      .eq("id", id)
      .eq("creditor_id", user.id)
      .maybeSingle();

    if (
      loadErr &&
      /source_group_id|source_member_id|column/i.test(loadErr.message)
    ) {
      const fallback = await supabase
        .from("pal_debts")
        .select("id, debtor_id, creditor_id")
        .eq("id", id)
        .eq("creditor_id", user.id)
        .maybeSingle();
      loadErr = fallback.error;
      existing = fallback.data
        ? { ...fallback.data, source_group_id: null, source_member_id: null }
        : null;
    }

    if (loadErr) return fail(loadErr.message, 400);

    if (existing) {
      let groupRestore: Awaited<
        ReturnType<typeof restoreGroupMemberFromPalDebt>
      > | null = null;
      try {
        groupRestore = await restoreGroupMemberFromPalDebt(supabase, user.id, {
          id: existing.id,
          creditor_id: existing.creditor_id as string,
          source_group_id: existing.source_group_id as string | null | undefined,
          source_member_id: existing.source_member_id as string | null | undefined,
        });
      } catch (e) {
        return fail(
          e instanceof Error ? e.message : "Could not restore group balance",
          400
        );
      }

      const { error } = await supabase
        .from("pal_debts")
        .delete()
        .eq("id", id)
        .eq("creditor_id", user.id);

      if (error) return fail(error.message, 400);

      try {
        const openRemaining = existing.debtor_id
          ? await recalculatePalDebtorAllocations(
              supabase,
              user.id,
              existing.debtor_id as string
            )
          : 0;
        return ok({
          deleted: true,
          open_remaining: openRemaining,
          group_restored: groupRestore?.restored ?? false,
          group_id: groupRestore?.group_id ?? null,
          member_id: groupRestore?.member_id ?? null,
        });
      } catch (e) {
        return fail(
          e instanceof Error ? e.message : "Deleted but could not rebalance",
          400
        );
      }
    }

    const { data: debtorDebt, error: debtorLoadErr } = await supabase
      .from("pal_debts")
      .select("id, debtor_id, creditor_id, source_group_id, source_member_id")
      .eq("id", id)
      .eq("debtor_id", user.id)
      .maybeSingle();

    if (debtorLoadErr) return fail(debtorLoadErr.message, 400);
    if (!debtorDebt) return notFound("Record not found");

    if (debtorDebt.source_group_id) {
      return fail("Group-linked debts can only be removed from Pal owes me", 400);
    }

    const creditorId = debtorDebt.creditor_id as string | null;
    const { error: debtorDeleteErr } = await supabase
      .from("pal_debts")
      .delete()
      .eq("id", id)
      .eq("debtor_id", user.id);

    if (debtorDeleteErr) return fail(debtorDeleteErr.message, 400);

    try {
      const openRemaining =
        creditorId != null
          ? await recalculatePalDebtorAllocations(
              supabase,
              creditorId,
              user.id
            )
          : 0;
      return ok({
        deleted: true,
        open_remaining: openRemaining,
        group_restored: false,
      });
    } catch (e) {
      return fail(
        e instanceof Error ? e.message : "Deleted but could not rebalance",
        400
      );
    }
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
