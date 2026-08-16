import { z } from "zod";
import { getAuthedClient } from "@/lib/supabase/auth";
import { ok, created, unauthorized, fail, fromZod, serverError } from "@/lib/api";
import {
  applyPalDebtorCredit,
  palDebtRemaining,
  palDebtorNetBalance,
} from "@/lib/pal-debt-balance";

const createSchema = z.object({
  debtor_id: z.string().uuid(),
  amount: z.number().positive().max(999_999_999),
  currency: z.string().length(3).optional(),
  description: z.string().max(500).nullable().optional(),
});

const debtSelectCreditorWithReceived =
  "id, creditor_id, debtor_id, amount, amount_received, currency, description, status, created_at, updated_at, settled_at, debtor:debtor_id(id, full_name, username, avatar_url, email)";

const debtSelectDebtorWithReceived =
  "id, creditor_id, debtor_id, amount, amount_received, currency, description, status, created_at, updated_at, settled_at, creditor:creditor_id(id, full_name, username, avatar_url, email, payment_methods)";

const debtSelectCreditorLegacy =
  "id, creditor_id, debtor_id, amount, currency, description, status, created_at, updated_at, settled_at, debtor:debtor_id(id, full_name, username, avatar_url, email)";

const debtSelectDebtorLegacy =
  "id, creditor_id, debtor_id, amount, currency, description, status, created_at, updated_at, settled_at, creditor:creditor_id(id, full_name, username, avatar_url, email)";

function normalizeDebtRows(rows: Record<string, unknown>[]) {
  return rows.map((row) => ({
    ...row,
    amount_received: row.amount_received != null ? Number(row.amount_received) : 0,
  })) as Array<Record<string, unknown> & { amount_received: number }>;
}

type Perspective = "creditor" | "debtor";

export async function GET(request: Request) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;

    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const perspective: Perspective =
      url.searchParams.get("perspective") === "debtor" ? "debtor" : "creditor";
    const ownerColumn = perspective === "creditor" ? "creditor_id" : "debtor_id";
    const debtSelectWithReceived =
      perspective === "creditor"
        ? debtSelectCreditorWithReceived
        : debtSelectDebtorWithReceived;
    const debtSelectLegacy =
      perspective === "creditor" ? debtSelectCreditorLegacy : debtSelectDebtorLegacy;

    async function fetchDebts(select: string) {
      let query = supabase
        .from("pal_debts")
        .select(select)
        .eq(ownerColumn, user.id)
        .order("created_at", { ascending: false });
      if (status === "open" || status === "paid" || status === "cancelled") {
        query = query.eq("status", status);
      }
      return query;
    }

    let debtsRes = await fetchDebts(debtSelectWithReceived);
    if (debtsRes.error && /amount_received|column/i.test(debtsRes.error.message)) {
      debtsRes = await fetchDebts(debtSelectLegacy);
    }
    if (debtsRes.error && /payment_methods|column/i.test(debtsRes.error.message)) {
      debtsRes = await fetchDebts(debtSelectDebtorLegacy);
    }
    if (debtsRes.error) return fail(debtsRes.error.message, 400);

    const openResWithReceived = await supabase
      .from("pal_debts")
      .select("creditor_id, debtor_id, amount, amount_received, currency, status")
      .eq(ownerColumn, user.id)
      .eq("status", "open");

    let openRows: Record<string, unknown>[] = [];
    if (openResWithReceived.error && /amount_received|column/i.test(openResWithReceived.error.message)) {
      const openResLegacy = await supabase
        .from("pal_debts")
        .select("creditor_id, debtor_id, amount, currency, status")
        .eq(ownerColumn, user.id)
        .eq("status", "open");
      if (openResLegacy.error) return fail(openResLegacy.error.message, 400);
      openRows = (openResLegacy.data ?? []) as Record<string, unknown>[];
    } else if (openResWithReceived.error) {
      return fail(openResWithReceived.error.message, 400);
    } else {
      openRows = (openResWithReceived.data ?? []) as Record<string, unknown>[];
    }

    const paymentsResWithScan = await supabase
      .from("pal_debt_payments")
      .select(
        "id, creditor_id, debtor_id, amount, currency, note, created_at, transaction_number, ocr_amount"
      )
      .eq(ownerColumn, user.id)
      .order("created_at", { ascending: false });

    let paymentsData: Record<string, unknown>[] = [];
    if (
      paymentsResWithScan.error &&
      /transaction_number|ocr_amount|column/i.test(paymentsResWithScan.error.message)
    ) {
      const legacy = await supabase
        .from("pal_debt_payments")
        .select("id, creditor_id, debtor_id, amount, currency, note, created_at")
        .eq(ownerColumn, user.id)
        .order("created_at", { ascending: false });
      if (legacy.error) return fail(legacy.error.message, 400);
      paymentsData = (legacy.data ?? []) as Record<string, unknown>[];
    } else if (paymentsResWithScan.error) {
      return fail(paymentsResWithScan.error.message, 400);
    } else {
      paymentsData = (paymentsResWithScan.data ?? []) as Record<string, unknown>[];
    }

    const creditsQuery = supabase.from("pal_debtor_credits").select("*").eq(ownerColumn, user.id);
    const creditsRes = await creditsQuery;

    const rows = normalizeDebtRows((debtsRes.data ?? []) as unknown as Record<string, unknown>[]);
    const openDebts = normalizeDebtRows(openRows);
    const credits =
      creditsRes.error &&
      /pal_debtor_credits|relation|does not exist/i.test(creditsRes.error.message)
        ? []
        : (creditsRes.data ?? []);

    const counterpartyColumn =
      perspective === "creditor" ? "debtor_id" : "creditor_id";

    const creditByCounterparty = new Map<string, number>();
    for (const c of credits) {
      const key = c[counterpartyColumn] as string;
      creditByCounterparty.set(key, Number(c.credit_balance ?? 0));
    }

    const openByCounterparty = new Map<string, number>();
    for (const d of openDebts) {
      const counterpartyId = d[counterpartyColumn] as string;
      const remaining = palDebtRemaining({
        amount: Number(d.amount),
        amount_received: Number(d.amount_received ?? 0),
        status: String(d.status),
      });
      if (remaining <= 0) continue;
      openByCounterparty.set(
        counterpartyId,
        (openByCounterparty.get(counterpartyId) ?? 0) + remaining
      );
    }

    let openTotal = 0;
    let openCount = 0;
    const counterpartyIds = new Set([
      ...openByCounterparty.keys(),
      ...creditByCounterparty.keys(),
    ]);
    for (const counterpartyId of counterpartyIds) {
      const net = palDebtorNetBalance(
        openByCounterparty.get(counterpartyId) ?? 0,
        creditByCounterparty.get(counterpartyId) ?? 0
      );
      if (net > 0) {
        openTotal += net;
        openCount += 1;
      }
    }

    return ok({
      perspective,
      debts: rows,
      payments: paymentsData,
      credits: credits.map((c) => ({
        creditor_id: c.creditor_id,
        debtor_id: c.debtor_id,
        credit_balance: Number(c.credit_balance ?? 0),
        currency: c.currency,
      })),
      summary: {
        open_count: openCount,
        open_total: openTotal,
        currency: (openDebts[0]?.currency as string) ?? (rows[0]?.currency as string) ?? "PHP",
      },
    });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}

export async function POST(request: Request) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;

    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    const { debtor_id, amount, currency, description } = parsed.data;
    if (debtor_id === user.id) return fail("You cannot record a debt to yourself", 400);

    const { data: debtor, error: debtorErr } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", debtor_id)
      .maybeSingle();

    if (debtorErr) return fail(debtorErr.message, 400);
    if (!debtor) return fail("User not found", 404);

    const insertRow = {
      creditor_id: user.id,
      debtor_id,
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
      .select(debtSelectCreditorWithReceived)
      .single();

    if (error && /amount_received|column/i.test(error.message)) {
      const { amount_received: _removed, ...legacyInsert } = insertRow;
      const legacy = await supabase
        .from("pal_debts")
        .insert(legacyInsert)
        .select(debtSelectCreditorLegacy)
        .single();
      if (legacy.error) return fail(legacy.error.message, 400);
      try {
        await applyPalDebtorCredit(supabase, user.id, debtor_id);
      } catch (e) {
        console.error("applyPalDebtorCredit after lent insert", e);
      }
      return created(normalizeDebtRows([legacy.data as Record<string, unknown>])[0]);
    }

    if (error) return fail(error.message, 400);

    try {
      await applyPalDebtorCredit(supabase, user.id, debtor_id);
    } catch (e) {
      console.error("applyPalDebtorCredit after lent insert", e);
    }

    return created(normalizeDebtRows([data as Record<string, unknown>])[0]);
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
