import { createClient } from "@/lib/supabase/server";
import { ok, unauthorized, serverError } from "@/lib/api";
import { computeOwedToYou } from "@/lib/owed-to-you";
import { computeConfirmedPayments } from "@/lib/confirmed-payments";
import {
  computeUserGroupSpend,
  computeUserGroupPayableBreakdown,
} from "@/lib/group-member-payments";
import { computeCollectorUnclaimed } from "@/lib/collector-unclaimed";
import {
  palDebtRemaining,
  aggregatePalNetByParty,
  sumPalPartyTotals,
} from "@/lib/pal-debt-balance";
import { pendingPartyKeyFromDebt } from "@/lib/pal-debt-display";
import { moneyNumber } from "@/lib/money";

export async function GET() {
  try {
    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ) {
      return unauthorized("Supabase not configured");
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return unauthorized();
    const userId = user.id;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const [
      receiptsRes,
      groupsRes,
      friendsRes,
      activitiesRes,
      notificationsRes,
      owedToYou,
      confirmed,
      userSpend,
      groupPayables,
      palDebtsOpenRes,
      palDebtsOweRes,
      spendReceiptsRes,
      unclaimed,
      palCreditsRes,
      palCreditsOweRes,
    ] = await Promise.all([
      supabase
        .from("receipts")
        .select("id, merchant, total, currency, status, created_at, group_id")
        .eq("created_by", user.id)
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("group_members")
        .select("group_id, groups(id, name, photo_url)")
        .eq("user_id", user.id)
        .limit(12),
      supabase
        .from("friends")
        .select("id", { count: "exact", head: true })
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
        .eq("status", "accepted"),
      supabase
        .from("activities")
        .select("id, action, metadata, created_at, group_id, receipt_id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .is("read_at", null),
      computeOwedToYou(supabase, user.id),
      computeConfirmedPayments(supabase, user.id),
      computeUserGroupSpend(supabase, user.id, startOfMonth),
      computeUserGroupPayableBreakdown(supabase, user.id),
      supabase
        .from("pal_debts")
        .select(
          "id, debtor_id, amount, amount_received, currency, pending_debtor_name, pending_debtor_email"
        )
        .eq("creditor_id", userId)
        .eq("status", "open"),
      supabase
        .from("pal_debts")
        .select(
          "id, creditor_id, amount, amount_received, currency, pending_creditor_name, pending_creditor_email"
        )
        .eq("debtor_id", userId)
        .eq("status", "open"),
      supabase
        .from("receipts")
        .select("total, created_at")
        .eq("created_by", user.id)
        .order("created_at", { ascending: false })
        .limit(500),
      computeCollectorUnclaimed(supabase, user.id),
      supabase
        .from("pal_debtor_credits")
        .select("debtor_id, credit_balance")
        .eq("creditor_id", user.id),
      supabase
        .from("pal_debtor_credits")
        .select("creditor_id, credit_balance")
        .eq("debtor_id", user.id),
    ]);

    const monthlySpend = userSpend.shareThisMonth;

    type PalDebtCreditorRow = {
      id: string;
      debtor_id: string | null;
      amount: number;
      amount_received?: number | null;
      currency: string;
      pending_debtor_name?: string | null;
      pending_debtor_email?: string | null;
    };

    type PalDebtDebtorRow = {
      id: string;
      creditor_id: string | null;
      amount: number;
      amount_received?: number | null;
      currency: string;
      pending_creditor_name?: string | null;
      pending_creditor_email?: string | null;
    };

    async function loadPalDebtsOpen(): Promise<PalDebtCreditorRow[]> {
      if (!palDebtsOpenRes.error) {
        return (palDebtsOpenRes.data ?? []) as PalDebtCreditorRow[];
      }
      if (!/pending_debtor_name|column/i.test(palDebtsOpenRes.error.message)) {
        return [];
      }
      const legacy = await supabase
        .from("pal_debts")
        .select("id, debtor_id, amount, amount_received, currency")
        .eq("creditor_id", userId)
        .eq("status", "open");
      if (legacy.error) return [];
      return (legacy.data ?? []) as PalDebtCreditorRow[];
    }

    async function loadPalDebtsOwe(): Promise<PalDebtDebtorRow[]> {
      if (!palDebtsOweRes.error) {
        return (palDebtsOweRes.data ?? []) as PalDebtDebtorRow[];
      }
      if (!/pending_creditor_name|column/i.test(palDebtsOweRes.error.message)) {
        return [];
      }
      const legacy = await supabase
        .from("pal_debts")
        .select("id, creditor_id, amount, amount_received, currency")
        .eq("debtor_id", userId)
        .eq("status", "open");
      if (legacy.error) return [];
      return (legacy.data ?? []) as PalDebtDebtorRow[];
    }

    const [palDebtsRaw, palDebtsOweRaw] = await Promise.all([
      loadPalDebtsOpen(),
      loadPalDebtsOwe(),
    ]);

    const palCredits =
      palCreditsRes.error &&
      /pal_debtor_credits|relation|does not exist/i.test(palCreditsRes.error.message)
        ? []
        : (palCreditsRes.data ?? []);

    const palCreditsOwe =
      palCreditsOweRes.error &&
      /pal_debtor_credits|relation|does not exist/i.test(palCreditsOweRes.error.message)
        ? []
        : (palCreditsOweRes.data ?? []);

    const creditByDebtor = new Map(
      palCredits.map((c) => [c.debtor_id as string, Number(c.credit_balance ?? 0)])
    );

    const creditByCreditor = new Map(
      palCreditsOwe.map((c) => [c.creditor_id as string, Number(c.credit_balance ?? 0)])
    );

    const debtorIds = [
      ...new Set(palDebtsRaw.map((d) => d.debtor_id).filter(Boolean)),
    ] as string[];
    const creditorIds = [
      ...new Set(palDebtsOweRaw.map((d) => d.creditor_id).filter(Boolean)),
    ] as string[];
    const profileIds = [...new Set([...debtorIds, ...creditorIds])];

    const { data: palProfiles } = profileIds.length
      ? await supabase
          .from("profiles")
          .select("id, full_name, username, email")
          .in("id", profileIds)
      : { data: [] };

    const profileById = new Map(
      (palProfiles ?? []).map((p) => [p.id as string, p])
    );

    function profileName(id: string) {
      const p = profileById.get(id);
      return p?.full_name?.trim() || p?.username || p?.email || "Someone";
    }

    function palPartyId(
      debt: PalDebtCreditorRow | PalDebtDebtorRow,
      perspective: "creditor" | "debtor"
    ): string {
      const pendingKey = pendingPartyKeyFromDebt(
        {
          id: debt.id,
          creditor_id:
            "creditor_id" in debt ? (debt.creditor_id as string | null) : null,
          debtor_id:
            "debtor_id" in debt ? (debt.debtor_id as string | null) : null,
          pending_debtor_name:
            "pending_debtor_name" in debt ? debt.pending_debtor_name : null,
          pending_creditor_name:
            "pending_creditor_name" in debt ? debt.pending_creditor_name : null,
        },
        perspective
      );
      if (pendingKey) return pendingKey;
      if (perspective === "creditor" && "debtor_id" in debt && debt.debtor_id) {
        return debt.debtor_id;
      }
      if (perspective === "debtor" && "creditor_id" in debt && debt.creditor_id) {
        return debt.creditor_id;
      }
      return `pending:${debt.id}`;
    }

    const palOwedNameByParty = new Map<string, string>();
    for (const d of palDebtsRaw) {
      const partyId = palPartyId(d, "creditor");
      if (!palOwedNameByParty.has(partyId)) {
        palOwedNameByParty.set(
          partyId,
          d.debtor_id
            ? profileName(d.debtor_id)
            : d.pending_debtor_name?.trim() || "Someone"
        );
      }
    }

    const palOweNameByParty = new Map<string, string>();
    for (const d of palDebtsOweRaw) {
      const partyId = palPartyId(d, "debtor");
      if (!palOweNameByParty.has(partyId)) {
        palOweNameByParty.set(
          partyId,
          d.creditor_id
            ? profileName(d.creditor_id)
            : d.pending_creditor_name?.trim() || "Someone"
        );
      }
    }

    const palOwedTotals = aggregatePalNetByParty(
      palDebtsRaw.map((d) => ({
        partyId: palPartyId(d, "creditor"),
        remaining: palDebtRemaining({
          amount: Number(d.amount),
          amount_received: d.amount_received,
          status: "open",
        }),
        currency: d.currency ?? "PHP",
      })),
      creditByDebtor,
      palDebtsRaw[0]?.currency ?? "PHP"
    );

    const palOweTotals = aggregatePalNetByParty(
      palDebtsOweRaw.map((d) => ({
        partyId: palPartyId(d, "debtor"),
        remaining: palDebtRemaining({
          amount: Number(d.amount),
          amount_received: d.amount_received,
          status: "open",
        }),
        currency: d.currency ?? "PHP",
      })),
      creditByCreditor,
      palDebtsOweRaw[0]?.currency ?? "PHP"
    );

    const palOwedToYou = palOwedTotals.map((r) => ({
      debtorId: r.partyId,
      name: palOwedNameByParty.get(r.partyId) ?? profileName(r.partyId),
      amount: r.amount,
      currency: r.currency,
      debtCount: r.debtCount,
    }));

    const palOweToOthers = palOweTotals.map((r) => ({
      creditorId: r.partyId,
      name: palOweNameByParty.get(r.partyId) ?? profileName(r.partyId),
      amount: r.amount,
      currency: r.currency,
      debtCount: r.debtCount,
    }));

    const palDebtsOpenTotal = sumPalPartyTotals(palOwedTotals);
    const palDebtsOweTotal = sumPalPartyTotals(palOweTotals);
    const spendReceipts = spendReceiptsRes.data ?? [];
    const overallSpent = moneyNumber(
      spendReceipts.reduce((sum, r) => sum + Number(r.total ?? 0), 0)
    );
    const balanceToCollect = moneyNumber(
      owedToYou.totalOwed + palDebtsOpenTotal + unclaimed.totalValue
    );
    // Unpaid group members + open pal debts + unclaimed line items (excludes marked-paid)
    const collectPendingCount =
      owedToYou.rows.length +
      palOwedToYou.length +
      unclaimed.itemCount;

    const months: { label: string; total: number; payments: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        label: d.toLocaleString("en", { month: "short" }),
        total: 0,
        payments: 0,
      });
    }

    const sixMonthsAgoIso = sixMonthsAgo.toISOString();
    const chartReceipts = spendReceipts.filter(
      (r) => new Date(r.created_at) >= sixMonthsAgo
    );

    for (const r of chartReceipts) {
      const d = new Date(r.created_at);
      const idx =
        (d.getFullYear() - sixMonthsAgo.getFullYear()) * 12 +
        (d.getMonth() - sixMonthsAgo.getMonth());
      if (idx >= 0 && idx < months.length) {
        months[idx].total += Number(r.total ?? 0);
      }
    }

    for (const p of confirmed.rows) {
      if (p.direction !== "received" || !p.paidAt) continue;
      const d = new Date(p.paidAt);
      const idx =
        (d.getFullYear() - sixMonthsAgo.getFullYear()) * 12 +
        (d.getMonth() - sixMonthsAgo.getMonth());
      if (idx >= 0 && idx < months.length) {
        months[idx].payments = moneyNumber(months[idx].payments + p.amount);
      }
    }

    const groups = (groupsRes.data ?? [])
      .map((row) => {
        const g = row.groups as unknown as
          | { id: string; name: string; photo_url: string | null }
          | { id: string; name: string; photo_url: string | null }[]
          | null;
        if (!g) return null;
        return Array.isArray(g) ? g[0] : g;
      })
      .filter(Boolean);

    const receivedThisMonth = confirmed.rows
      .filter((p) => {
        if (p.direction !== "received" || !p.paidAt) return false;
        return new Date(p.paidAt) >= new Date(startOfMonth);
      })
      .reduce((s, p) => moneyNumber(s + p.amount), 0);

    return ok({
      stats: {
        userSpent: userSpend.totalShare,
        userSpentThisMonth: userSpend.shareThisMonth,
        overallSpent,
        userOwes: groupPayables.totalOwes,
        groupPayableCount: groupPayables.groups.length,
        monthlySpend,
        groupsCount: groups.length,
        friendsCount: friendsRes.count ?? 0,
        unreadNotifications: notificationsRes.count ?? 0,
        mostActiveGroup: groups[0]?.name ?? null,
        totalOwedToYou: owedToYou.totalOwed,
        palDebtsOpenTotal,
        palDebtsOweTotal,
        balanceToCollect,
        unclaimedItemCount: unclaimed.itemCount,
        unclaimedItemValue: unclaimed.totalValue,
        collectPendingCount,
        totalPaymentsReceived: confirmed.totalReceived,
        totalPaymentsSent: confirmed.totalSent,
        paymentsReceivedThisMonth: receivedThisMonth,
      },
      recentReceipts: receiptsRes.data ?? [],
      groups,
      activities: activitiesRes.data ?? [],
      monthlyChart: months,
      owedToYou: owedToYou.rows,
      palOwedToYou,
      palOweToOthers,
      unclaimedReceipts: unclaimed.receipts,
      confirmedPayments: confirmed.rows,
      groupPayables,
    });
  } catch (error) {
    console.error(error);
    return serverError("Failed to load dashboard");
  }
}
