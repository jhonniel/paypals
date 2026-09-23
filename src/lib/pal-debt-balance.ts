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
  creditor_id: string | null;
  debtor_id: string | null;
  pending_party_key?: string | null;
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

export async function getPalDebtorCreditBalance(
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

/** FIFO allocate payment onto specific open debts (manual / pending pals). */
async function allocatePaymentToDebtIds(
  supabase: SupabaseClient,
  userId: string,
  side: "creditor" | "debtor",
  debtIds: string[],
  paymentAmount: number
): Promise<number> {
  const amount = moneyNumber(paymentAmount);
  if (amount <= 0 || debtIds.length === 0) return amount;

  let query = supabase
    .from("pal_debts")
    .select("id, amount, amount_received, status, created_at, creditor_id, debtor_id")
    .in("id", debtIds)
    .eq("status", "open")
    .order("created_at", { ascending: true });

  query =
    side === "creditor"
      ? query.eq("creditor_id", userId)
      : query.eq("debtor_id", userId);

  const { data: openDebts, error: debtsErr } = await query;
  if (debtsErr) throw new Error(debtsErr.message);

  let remaining = amount;
  for (const debt of openDebts ?? []) {
    if (remaining <= 0) break;
    const owed = palDebtRemaining({
      amount: Number(debt.amount),
      amount_received: debt.amount_received,
      status: String(debt.status),
    });
    if (owed <= 0) continue;

    const apply = moneyNumber(Math.min(remaining, owed));
    const nextReceived = moneyNumber(Number(debt.amount_received ?? 0) + apply);
    const fullyPaid = nextReceived >= Number(debt.amount);

    let updateQuery = supabase
      .from("pal_debts")
      .update({
        amount_received: nextReceived,
        status: fullyPaid ? "paid" : "open",
        settled_at: fullyPaid ? new Date().toISOString() : null,
      })
      .eq("id", debt.id);

    updateQuery =
      side === "creditor"
        ? updateQuery.eq("creditor_id", userId)
        : updateQuery.eq("debtor_id", userId);

    const { error: upErr } = await updateQuery;
    if (upErr) throw new Error(upErr.message);
    remaining = moneyNumber(remaining - apply);
  }

  return remaining;
}

async function sumOpenRemainingForDebtIds(
  supabase: SupabaseClient,
  userId: string,
  side: "creditor" | "debtor",
  debtIds: string[]
): Promise<number> {
  if (debtIds.length === 0) return 0;

  let query = supabase
    .from("pal_debts")
    .select("id, amount, amount_received, status, debtor_id")
    .in("id", debtIds)
    .eq("status", "open");

  query =
    side === "creditor"
      ? query.eq("creditor_id", userId)
      : query.eq("debtor_id", userId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return sumPalDebtorOpen((data ?? []) as PalDebtRow[]);
}

/** Record received/paid on manual pal debts before the other person has an account. */
export async function applyPendingPalPayment(
  supabase: SupabaseClient,
  params: {
    userId: string;
    side: "creditor" | "debtor";
    pendingPartyKey: string;
    debtIds: string[];
    paymentAmount: number;
    currency: string;
    note: string | null;
    scan?: {
      transactionNumber: string | null;
      ocrAmount: number | null;
      ocrRaw: Record<string, unknown>;
    };
  }
): Promise<{ payment: PalDebtPaymentRow; openRemaining: number; creditBalance: number }> {
  const amount = moneyNumber(params.paymentAmount);
  if (amount <= 0) {
    throw new Error("Enter a valid amount");
  }
  if (params.debtIds.length === 0) {
    throw new Error("No open debts to apply payment to");
  }

  const { data: ownedDebts, error: ownedErr } = await supabase
    .from("pal_debts")
    .select("id, creditor_id, debtor_id, status")
    .in("id", params.debtIds);

  if (ownedErr) throw new Error(ownedErr.message);
  if ((ownedDebts ?? []).length !== params.debtIds.length) {
    throw new Error("One or more debts were not found");
  }

  for (const debt of ownedDebts ?? []) {
    if (params.side === "creditor") {
      if (debt.creditor_id !== params.userId || debt.debtor_id != null) {
        throw new Error("Invalid manual debt for payment");
      }
    } else if (debt.debtor_id !== params.userId || debt.creditor_id != null) {
      throw new Error("Invalid manual debt for payment");
    }
  }

  const insertRow: Record<string, unknown> = {
    creditor_id: params.side === "creditor" ? params.userId : null,
    debtor_id: params.side === "debtor" ? params.userId : null,
    pending_party_key: params.pendingPartyKey.trim(),
    amount,
    currency: params.currency.toUpperCase(),
    note: params.note?.trim() || null,
  };
  if (params.scan) {
    insertRow.transaction_number = params.scan.transactionNumber;
    insertRow.ocr_amount = params.scan.ocrAmount;
    insertRow.ocr_raw = params.scan.ocrRaw;
  }

  const paymentSelect =
    "id, creditor_id, debtor_id, pending_party_key, amount, currency, note, created_at, transaction_number, ocr_amount";
  const paymentSelectLegacy =
    "id, creditor_id, debtor_id, amount, currency, note, created_at";

  let { data: payment, error: payErr } = await supabase
    .from("pal_debt_payments")
    .insert(insertRow)
    .select(paymentSelect)
    .single();

  if (
    payErr &&
    /pending_party_key|transaction_number|ocr_amount|column/i.test(payErr.message)
  ) {
    return failPendingMigration();
  }

  if (payErr && /transaction_number|ocr_amount|column/i.test(payErr.message)) {
    const {
      transaction_number: _c,
      ocr_amount: _d,
      ocr_raw: _e,
      pending_party_key: _p,
      ...legacyInsert
    } = insertRow;
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

  await allocatePaymentToDebtIds(
    supabase,
    params.userId,
    params.side,
    params.debtIds,
    amount
  );

  const openRemaining = await sumOpenRemainingForDebtIds(
    supabase,
    params.userId,
    params.side,
    params.debtIds
  );

  return {
    payment: payment as PalDebtPaymentRow,
    openRemaining,
    creditBalance: 0,
  };
}

function failPendingMigration(): never {
  throw new Error(
    "Manual pal payments require database migration 039_pal_debt_pending_payments.sql"
  );
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

async function loadPendingPartyDebtIds(
  supabase: SupabaseClient,
  userId: string,
  side: "creditor" | "debtor",
  pendingPartyKey: string
): Promise<string[]> {
  let query = supabase
    .from("pal_debts")
    .select("id, pending_debtor_name, pending_creditor_name")
    .neq("status", "cancelled");

  query =
    side === "creditor"
      ? query.eq("creditor_id", userId).is("debtor_id", null)
      : query.eq("debtor_id", userId).is("creditor_id", null);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  if (pendingPartyKey.startsWith("pending:")) {
    const id = pendingPartyKey.slice("pending:".length);
    return rows.filter((d) => d.id === id).map((d) => d.id as string);
  }
  if (pendingPartyKey.startsWith("pending-creditor:")) {
    const id = pendingPartyKey.slice("pending-creditor:".length);
    return rows.filter((d) => d.id === id).map((d) => d.id as string);
  }
  if (pendingPartyKey.startsWith("pending-name:")) {
    const name = pendingPartyKey.slice("pending-name:".length);
    return rows
      .filter(
        (d) => (d.pending_debtor_name as string | null)?.trim().toLowerCase() === name
      )
      .map((d) => d.id as string);
  }
  if (pendingPartyKey.startsWith("pending-creditor-name:")) {
    const name = pendingPartyKey.slice("pending-creditor-name:".length);
    return rows
      .filter(
        (d) =>
          (d.pending_creditor_name as string | null)?.trim().toLowerCase() === name
      )
      .map((d) => d.id as string);
  }
  return [];
}

/** Replay pending-party payments onto manual pal debts. */
export async function recalculatePendingPartyPayments(
  supabase: SupabaseClient,
  userId: string,
  side: "creditor" | "debtor",
  pendingPartyKey: string
): Promise<number> {
  const debtIds = await loadPendingPartyDebtIds(
    supabase,
    userId,
    side,
    pendingPartyKey
  );
  if (debtIds.length === 0) return 0;

  for (const debtId of debtIds) {
    let resetQuery = supabase
      .from("pal_debts")
      .update({
        amount_received: 0,
        status: "open",
        settled_at: null,
      })
      .eq("id", debtId);
    resetQuery =
      side === "creditor"
        ? resetQuery.eq("creditor_id", userId)
        : resetQuery.eq("debtor_id", userId);
    const { error } = await resetQuery;
    if (error) throw new Error(error.message);
  }

  const ownerColumn = side === "creditor" ? "creditor_id" : "debtor_id";
  const { data: payments, error: payErr } = await supabase
    .from("pal_debt_payments")
    .select("id, amount, currency, created_at")
    .eq("pending_party_key", pendingPartyKey)
    .eq(ownerColumn, userId)
    .order("created_at", { ascending: true });

  if (payErr) throw new Error(payErr.message);

  for (const payment of payments ?? []) {
    await allocatePaymentToDebtIds(
      supabase,
      userId,
      side,
      debtIds,
      Number(payment.amount)
    );
  }

  return sumOpenRemainingForDebtIds(supabase, userId, side, debtIds);
}

/** Delete a payment (creditor or debtor, linked or manual) and rebalance. */
export async function deletePalPayment(
  supabase: SupabaseClient,
  userId: string,
  paymentId: string
): Promise<{ openRemaining: number; creditBalance: number }> {
  const { data: payment, error: loadErr } = await supabase
    .from("pal_debt_payments")
    .select("id, creditor_id, debtor_id, pending_party_key, amount")
    .eq("id", paymentId)
    .maybeSingle();

  if (loadErr) throw new Error(loadErr.message);
  if (!payment) throw new Error("Payment not found");

  const isOwner =
    payment.creditor_id === userId || payment.debtor_id === userId;
  if (!isOwner) throw new Error("Payment not found");

  const { error: delErr } = await supabase
    .from("pal_debt_payments")
    .delete()
    .eq("id", paymentId);

  if (delErr) throw new Error(delErr.message);

  if (payment.pending_party_key) {
    const side = payment.creditor_id === userId ? "creditor" : "debtor";
    const openRemaining = await recalculatePendingPartyPayments(
      supabase,
      userId,
      side,
      payment.pending_party_key as string
    );
    return { openRemaining, creditBalance: 0 };
  }

  const creditorId = payment.creditor_id as string;
  const debtorId = payment.debtor_id as string;
  const openRemaining = await recalculatePalDebtorAllocations(
    supabase,
    creditorId,
    debtorId
  );
  const creditBalance = await getPalDebtorCreditBalance(
    supabase,
    creditorId,
    debtorId
  );

  return { openRemaining, creditBalance };
}

/** Update payment amount/note and rebalance allocations. */
export async function updatePalPayment(
  supabase: SupabaseClient,
  userId: string,
  paymentId: string,
  patch: { amount?: number; note?: string | null }
): Promise<{ openRemaining: number; creditBalance: number }> {
  const { data: payment, error: loadErr } = await supabase
    .from("pal_debt_payments")
    .select("id, creditor_id, debtor_id, pending_party_key, amount")
    .eq("id", paymentId)
    .maybeSingle();

  if (loadErr) throw new Error(loadErr.message);
  if (!payment) throw new Error("Payment not found");
  if (payment.creditor_id !== userId && payment.debtor_id !== userId) {
    throw new Error("Payment not found");
  }

  const updateRow: Record<string, unknown> = {};
  if (patch.amount != null) {
    const amount = moneyNumber(patch.amount);
    if (amount <= 0) throw new Error("Enter a valid amount");
    updateRow.amount = amount;
  }
  if (patch.note !== undefined) {
    updateRow.note = patch.note?.trim() || null;
  }
  if (Object.keys(updateRow).length === 0) {
    throw new Error("Nothing to update");
  }

  const { error: upErr } = await supabase
    .from("pal_debt_payments")
    .update(updateRow)
    .eq("id", paymentId);

  if (upErr) throw new Error(upErr.message);

  if (payment.pending_party_key) {
    const side = payment.creditor_id === userId ? "creditor" : "debtor";
    const openRemaining = await recalculatePendingPartyPayments(
      supabase,
      userId,
      side,
      payment.pending_party_key as string
    );
    return { openRemaining, creditBalance: 0 };
  }

  const creditorId = payment.creditor_id as string;
  const debtorId = payment.debtor_id as string;
  const openRemaining = await recalculatePalDebtorAllocations(
    supabase,
    creditorId,
    debtorId
  );
  const creditBalance = await getPalDebtorCreditBalance(
    supabase,
    creditorId,
    debtorId
  );

  return { openRemaining, creditBalance };
}

/** Delete a received payment and restore lent balances by replaying remaining payments. */
export async function deletePalReceivedPayment(
  supabase: SupabaseClient,
  creditorId: string,
  paymentId: string
): Promise<{ openRemaining: number; creditBalance: number }> {
  return deletePalPayment(supabase, creditorId, paymentId);
}
