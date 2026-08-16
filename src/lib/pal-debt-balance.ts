import type { SupabaseClient } from "@supabase/supabase-js";
import { moneyNumber } from "@/lib/money";

export type PalDebtRow = {
  id: string;
  debtor_id: string;
  amount: number;
  amount_received?: number | null;
  currency: string;
  status: string;
  created_at: string;
};

export type PalDebtPaymentRow = {
  id: string;
  creditor_id: string;
  debtor_id: string;
  amount: number;
  currency: string;
  note: string | null;
  created_at: string;
  transaction_number?: string | null;
  ocr_amount?: number | null;
};

export type PalDebtorCreditRow = {
  creditor_id: string;
  debtor_id: string;
  credit_balance: number;
  currency: string;
};

export function palDebtRemaining(debt: {
  amount: number;
  amount_received?: number | null;
  status: string;
}): number {
  if (debt.status === "paid") return 0;
  return moneyNumber(
    Math.max(0, Number(debt.amount) - Number(debt.amount_received ?? 0))
  );
}

export function sumPalDebtorOpen(debts: PalDebtRow[], debtorId?: string): number {
  return moneyNumber(
    debts
      .filter((d) => (debtorId ? d.debtor_id === debtorId : true) && d.status === "open")
      .reduce((sum, d) => sum + palDebtRemaining(d), 0)
  );
}

/** Net balance: positive = pal owes you, negative = overpaid credit. */
export function palDebtorNetBalance(openTotal: number, creditBalance: number): number {
  return moneyNumber(openTotal - creditBalance);
}

export type PalDebtPartyTotal = {
  partyId: string;
  amount: number;
  currency: string;
  debtCount: number;
};

/** Sum open pal debt net balances per counterparty (after credit). */
export function aggregatePalNetByParty(
  debts: Array<{ partyId: string; remaining: number; currency: string }>,
  creditByParty: Map<string, number>,
  defaultCurrency = "PHP"
): PalDebtPartyTotal[] {
  const openByParty = new Map<
    string,
    { amount: number; currency: string; debtCount: number }
  >();

  for (const debt of debts) {
    if (debt.remaining <= 0) continue;
    const row = openByParty.get(debt.partyId) ?? {
      amount: 0,
      currency: debt.currency,
      debtCount: 0,
    };
    row.amount = moneyNumber(row.amount + debt.remaining);
    row.debtCount += 1;
    openByParty.set(debt.partyId, row);
  }

  const partyIds = new Set([...openByParty.keys(), ...creditByParty.keys()]);
  const rows: PalDebtPartyTotal[] = [];

  for (const partyId of partyIds) {
    const open = openByParty.get(partyId);
    const net = palDebtorNetBalance(
      open?.amount ?? 0,
      creditByParty.get(partyId) ?? 0
    );
    if (net <= 0) continue;
    rows.push({
      partyId,
      amount: net,
      currency: open?.currency ?? defaultCurrency,
      debtCount: open?.debtCount ?? 0,
    });
  }

  return rows.sort((a, b) => b.amount - a.amount);
}

export function sumPalPartyTotals(rows: PalDebtPartyTotal[]): number {
  return moneyNumber(rows.reduce((sum, r) => sum + r.amount, 0));
}

async function getPalDebtorCreditBalance(
  supabase: SupabaseClient,
  creditorId: string,
  debtorId: string
): Promise<number> {
  const { data, error } = await supabase
    .from("pal_debtor_credits")
    .select("credit_balance")
    .eq("creditor_id", creditorId)
    .eq("debtor_id", debtorId)
    .maybeSingle();

  if (error) {
    if (/pal_debtor_credits|relation|does not exist/i.test(error.message)) return 0;
    throw new Error(error.message);
  }
  return moneyNumber(Number(data?.credit_balance ?? 0));
}

async function setPalDebtorCreditBalance(
  supabase: SupabaseClient,
  creditorId: string,
  debtorId: string,
  creditBalance: number,
  currency: string
): Promise<void> {
  const balance = moneyNumber(Math.max(0, creditBalance));
  if (balance <= 0) {
    const { error: delErr } = await supabase
      .from("pal_debtor_credits")
      .delete()
      .eq("creditor_id", creditorId)
      .eq("debtor_id", debtorId);
    if (delErr && !/pal_debtor_credits|relation|does not exist/i.test(delErr.message)) {
      throw new Error(delErr.message);
    }
    return;
  }

  const { error: upErr } = await supabase.from("pal_debtor_credits").upsert(
    {
      creditor_id: creditorId,
      debtor_id: debtorId,
      credit_balance: balance,
      currency: currency.toUpperCase(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "creditor_id,debtor_id" }
  );

  if (upErr) {
    if (/pal_debtor_credits|relation|does not exist/i.test(upErr.message)) return;
    throw new Error(upErr.message);
  }
}

/** Apply stored credit against open debts (oldest first). */
export async function applyPalDebtorCredit(
  supabase: SupabaseClient,
  creditorId: string,
  debtorId: string
): Promise<number> {
  let credit = await getPalDebtorCreditBalance(supabase, creditorId, debtorId);
  if (credit <= 0) return 0;

  const { data: openDebts, error: debtsErr } = await supabase
    .from("pal_debts")
    .select("id, amount, amount_received, status, currency, created_at, debtor_id")
    .eq("creditor_id", creditorId)
    .eq("debtor_id", debtorId)
    .eq("status", "open")
    .order("created_at", { ascending: true });

  if (debtsErr) throw new Error(debtsErr.message);

  let currency = "PHP";
  for (const debt of openDebts ?? []) {
    if (credit <= 0) break;
    const owed = palDebtRemaining(debt as PalDebtRow);
    if (owed <= 0) continue;

    currency = (debt as PalDebtRow).currency ?? currency;
    const apply = moneyNumber(Math.min(credit, owed));
    const nextReceived = moneyNumber(Number(debt.amount_received ?? 0) + apply);
    const fullyPaid = nextReceived >= Number(debt.amount);

    const { error: upErr } = await supabase
      .from("pal_debts")
      .update({
        amount_received: nextReceived,
        status: fullyPaid ? "paid" : "open",
        settled_at: fullyPaid ? new Date().toISOString() : null,
      })
      .eq("id", debt.id)
      .eq("creditor_id", creditorId);

    if (upErr) throw new Error(upErr.message);
    credit = moneyNumber(credit - apply);
  }

  await setPalDebtorCreditBalance(supabase, creditorId, debtorId, credit, currency);
  return credit;
}

/** FIFO allocate a received amount onto debts. Returns unallocated overpayment. */
async function allocatePaymentAmount(
  supabase: SupabaseClient,
  creditorId: string,
  debtorId: string,
  paymentAmount: number,
  options?: { debtId?: string }
): Promise<number> {
  const amount = moneyNumber(paymentAmount);
  if (amount <= 0) return 0;

  let openDebtsQuery = supabase
    .from("pal_debts")
    .select("id, amount, amount_received, status, created_at, debtor_id")
    .eq("creditor_id", creditorId)
    .eq("debtor_id", debtorId)
    .eq("status", "open")
    .order("created_at", { ascending: true });

  if (options?.debtId) {
    openDebtsQuery = openDebtsQuery.eq("id", options.debtId);
  }

  const { data: openDebts, error: debtsErr } = await openDebtsQuery;
  if (debtsErr) throw new Error(debtsErr.message);

  let remaining = amount;
  for (const debt of openDebts ?? []) {
    if (remaining <= 0) break;
    const owed = palDebtRemaining(debt as PalDebtRow);
    if (owed <= 0) continue;

    const apply = moneyNumber(Math.min(remaining, owed));
    const nextReceived = moneyNumber(Number(debt.amount_received ?? 0) + apply);
    const fullyPaid = nextReceived >= Number(debt.amount);

    const { error: upErr } = await supabase
      .from("pal_debts")
      .update({
        amount_received: nextReceived,
        status: fullyPaid ? "paid" : "open",
        settled_at: fullyPaid ? new Date().toISOString() : null,
      })
      .eq("id", debt.id)
      .eq("creditor_id", creditorId);

    if (upErr) throw new Error(upErr.message);
    remaining = moneyNumber(remaining - apply);
  }

  return remaining;
}

/** Reset allocations, replay payments, rebuild credit from overpayments. */
export async function recalculatePalDebtorAllocations(
  supabase: SupabaseClient,
  creditorId: string,
  debtorId: string
): Promise<number> {
  const [{ data: debts, error: debtsErr }, { data: payments, error: payErr }] =
    await Promise.all([
      supabase
        .from("pal_debts")
        .select("id, amount, amount_received, status, currency, created_at, debtor_id")
        .eq("creditor_id", creditorId)
        .eq("debtor_id", debtorId)
        .neq("status", "cancelled"),
      supabase
        .from("pal_debt_payments")
        .select("id, amount, currency, created_at")
        .eq("creditor_id", creditorId)
        .eq("debtor_id", debtorId)
        .order("created_at", { ascending: true }),
    ]);

  if (debtsErr) throw new Error(debtsErr.message);
  if (payErr) throw new Error(payErr.message);

  for (const debt of debts ?? []) {
    const { error } = await supabase
      .from("pal_debts")
      .update({
        amount_received: 0,
        status: "open",
        settled_at: null,
      })
      .eq("id", debt.id)
      .eq("creditor_id", creditorId);
    if (error) throw new Error(error.message);
  }

  let creditBalance = 0;
  let currency =
    (payments?.[0]?.currency as string | undefined) ??
    (debts?.[0]?.currency as string | undefined) ??
    "PHP";

  for (const payment of payments ?? []) {
    const overpay = await allocatePaymentAmount(
      supabase,
      creditorId,
      debtorId,
      Number(payment.amount)
    );
    creditBalance = moneyNumber(creditBalance + overpay);
    currency = (payment.currency as string) ?? currency;
  }

  await setPalDebtorCreditBalance(
    supabase,
    creditorId,
    debtorId,
    creditBalance,
    currency
  );
  await applyPalDebtorCredit(supabase, creditorId, debtorId);

  const [{ data: afterDebts }, creditAfter] = await Promise.all([
    supabase
      .from("pal_debts")
      .select("id, debtor_id, amount, amount_received, status, currency, created_at")
      .eq("creditor_id", creditorId)
      .eq("debtor_id", debtorId)
      .eq("status", "open"),
    getPalDebtorCreditBalance(supabase, creditorId, debtorId),
  ]);

  const openTotal = sumPalDebtorOpen((afterDebts ?? []) as PalDebtRow[]);
  return palDebtorNetBalance(openTotal, creditAfter);
}

/** Record received payment; overpayment becomes credit for future lent records. */
export async function applyPalReceivedPayment(
  supabase: SupabaseClient,
  creditorId: string,
  debtorId: string,
  paymentAmount: number,
  currency: string,
  note: string | null,
  options?: {
    debtId?: string;
    scan?: {
      transactionNumber: string | null;
      ocrAmount: number | null;
      ocrRaw: Record<string, unknown>;
    };
  }
): Promise<{ payment: PalDebtPaymentRow; openRemaining: number; creditBalance: number }> {
  const amount = moneyNumber(paymentAmount);
  if (amount <= 0) {
    throw new Error("Enter a valid amount");
  }

  const insertRow: Record<string, unknown> = {
    creditor_id: creditorId,
    debtor_id: debtorId,
    amount,
    currency: currency.toUpperCase(),
    note: note?.trim() || null,
  };
  if (options?.scan) {
    insertRow.transaction_number = options.scan.transactionNumber;
    insertRow.ocr_amount = options.scan.ocrAmount;
    insertRow.ocr_raw = options.scan.ocrRaw;
  }

  const paymentSelect =
    "id, creditor_id, debtor_id, amount, currency, note, created_at, transaction_number, ocr_amount";
  const paymentSelectLegacy =
    "id, creditor_id, debtor_id, amount, currency, note, created_at";

  let { data: payment, error: payErr } = await supabase
    .from("pal_debt_payments")
    .insert(insertRow)
    .select(paymentSelect)
    .single();

  if (payErr && /transaction_number|ocr_amount|column/i.test(payErr.message)) {
    const { transaction_number: _c, ocr_amount: _d, ocr_raw: _e, ...legacyInsert } =
      insertRow;
    const legacy = await supabase
      .from("pal_debt_payments")
      .insert(legacyInsert)
      .select(paymentSelectLegacy)
      .single();
    payment = legacy.data as typeof payment;
    payErr = legacy.error;
  }

  if (payErr) throw new Error(payErr.message);
  if (!payment) throw new Error("Could not save payment");

  const overpay = await allocatePaymentAmount(
    supabase,
    creditorId,
    debtorId,
    amount,
    options
  );

  if (overpay > 0) {
    const existingCredit = await getPalDebtorCreditBalance(
      supabase,
      creditorId,
      debtorId
    );
    await setPalDebtorCreditBalance(
      supabase,
      creditorId,
      debtorId,
      moneyNumber(existingCredit + overpay),
      currency
    );
  }

  const [{ data: afterDebts }, creditBalance] = await Promise.all([
    supabase
      .from("pal_debts")
      .select("id, debtor_id, amount, amount_received, status, currency, created_at")
      .eq("creditor_id", creditorId)
      .eq("debtor_id", debtorId)
      .eq("status", "open"),
    getPalDebtorCreditBalance(supabase, creditorId, debtorId),
  ]);

  const openTotal = sumPalDebtorOpen((afterDebts ?? []) as PalDebtRow[]);
  const openRemaining = palDebtorNetBalance(openTotal, creditBalance);

  return {
    payment: payment as PalDebtPaymentRow,
    openRemaining,
    creditBalance,
  };
}

/** Delete a received payment and restore lent balances by replaying remaining payments. */
export async function deletePalReceivedPayment(
  supabase: SupabaseClient,
  creditorId: string,
  paymentId: string
): Promise<{ openRemaining: number; creditBalance: number }> {
  const { data: payment, error: loadErr } = await supabase
    .from("pal_debt_payments")
    .select("id, creditor_id, debtor_id, amount")
    .eq("id", paymentId)
    .eq("creditor_id", creditorId)
    .maybeSingle();

  if (loadErr) throw new Error(loadErr.message);
  if (!payment) throw new Error("Payment not found");

  const { error: delErr } = await supabase
    .from("pal_debt_payments")
    .delete()
    .eq("id", paymentId)
    .eq("creditor_id", creditorId);

  if (delErr) throw new Error(delErr.message);

  const openRemaining = await recalculatePalDebtorAllocations(
    supabase,
    creditorId,
    payment.debtor_id as string
  );
  const creditBalance = await getPalDebtorCreditBalance(
    supabase,
    creditorId,
    payment.debtor_id as string
  );

  return { openRemaining, creditBalance };
}
