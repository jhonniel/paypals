import { getAuthedClient } from "@/lib/supabase/auth";
import { ok, unauthorized, serverError, fail } from "@/lib/api";
import { moneyNumber } from "@/lib/money";
import { computeConfirmedPayments } from "@/lib/confirmed-payments";
import {
  computeSplitBalances,
  type AssignmentInput,
  type ItemSplitInput,
  type ItemSplitMode,
} from "@/lib/splits";
import { format, subMonths, startOfMonth } from "date-fns";

function categorizeMerchant(merchant: string | null): string {
  const m = (merchant ?? "").toLowerCase();
  if (/coffee|cafe|starbucks|dunkin|kopi|latte|mocha/.test(m)) return "Coffee & cafes";
  if (
    /resto|restaurant|grill|kitchen|bistro|jollibee|mcdo|kfc|pizza|sushi|bar|food|dining/.test(
      m
    )
  )
    return "Restaurants";
  if (/grocery|market|supermarket|sari|puregold|sm hyper|robinsons|landers/.test(m))
    return "Groceries";
  if (/grab|uber|taxi|lrt|mrt|bus|petron|shell|caltex|angkas|joyride/.test(m))
    return "Transport";
  if (/mall|uniqlo|zara|h&m|nike|adidas|shopee|lazada/.test(m)) return "Shopping";
  if (/pharmacy|mercury|watsons|clinic|hospital|dentist/.test(m)) return "Health";
  return "Other";
}

function emptyMonths() {
  const monthMap = new Map<string, { spend: number; payments: number }>();
  for (let i = 5; i >= 0; i--) {
    const key = format(subMonths(new Date(), i), "yyyy-MM");
    monthMap.set(key, { spend: 0, payments: 0 });
  }
  return monthMap;
}

export async function GET() {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;

    const sixMonthsAgo = startOfMonth(subMonths(new Date(), 5));
    const sixMonthsAgoIso = sixMonthsAgo.toISOString();

    // Memberships + confirmed payments in parallel
    const [{ data: memberships }, confirmed] = await Promise.all([
      supabase
        .from("group_members")
        .select("id, group_id, groups(id, name)")
        .eq("user_id", user.id),
      computeConfirmedPayments(supabase, user.id),
    ]);

    const groupIds = [...new Set((memberships ?? []).map((m) => m.group_id))];
    const memberIdByGroup = new Map(
      (memberships ?? []).map((m) => [m.group_id, m.id])
    );

    // Receipts you created + receipts in your groups (for merchants / categories / shares)
    const [createdRes, groupReceiptsRes] = await Promise.all([
      supabase
        .from("receipts")
        .select(
          "id, merchant, total, currency, status, group_id, created_at, tip, tax, discount, service_charge"
        )
        .eq("created_by", user.id)
        .gte("created_at", sixMonthsAgoIso)
        .order("created_at", { ascending: true }),
      groupIds.length
        ? supabase
            .from("receipts")
            .select(
              "id, merchant, total, currency, status, group_id, created_at, tip, tax, discount, service_charge"
            )
            .in("group_id", groupIds)
            .gte("created_at", sixMonthsAgoIso)
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [] as never[], error: null }),
    ]);

    if (createdRes.error) return fail(createdRes.error.message, 400);
    if (groupReceiptsRes.error) return fail(groupReceiptsRes.error.message, 400);

    const receiptById = new Map<
      string,
      {
        id: string;
        merchant: string | null;
        total: number;
        currency: string;
        status: string;
        group_id: string | null;
        created_at: string;
        tip: number;
        tax: number;
        discount: number;
        service_charge: number;
      }
    >();
    for (const r of [...(createdRes.data ?? []), ...(groupReceiptsRes.data ?? [])]) {
      receiptById.set(r.id, {
        id: r.id,
        merchant: r.merchant,
        total: Number(r.total ?? 0),
        currency: r.currency || "PHP",
        status: r.status,
        group_id: r.group_id,
        created_at: r.created_at,
        tip: Number(r.tip ?? 0),
        tax: Number(r.tax ?? 0),
        discount: Number(r.discount ?? 0),
        service_charge: Number(r.service_charge ?? 0),
      });
    }
    const allReceipts = [...receiptById.values()];
    const receiptIds = allReceipts.map((r) => r.id);

    // Items + assignments for share computation
    const itemsByReceipt = new Map<
      string,
      Array<{
        id: string;
        name: string;
        quantity: number;
        total_price: number;
        split_mode: string | null;
        split_n: number | null;
      }>
    >();
    const assignmentsByItem = new Map<
      string,
      Array<{
        member_id: string;
        split_method: AssignmentInput["splitMethod"];
        share_percentage: number | null;
        share_quantity: number | null;
        share_amount: number | null;
      }>
    >();
    const membersByGroup = new Map<string, string[]>();

    if (receiptIds.length) {
      const [{ data: items }, { data: allGroupMembers }] = await Promise.all([
        supabase
          .from("receipt_items")
          .select("id, receipt_id, name, quantity, total_price, split_mode, split_n")
          .in("receipt_id", receiptIds),
        groupIds.length
          ? supabase
              .from("group_members")
              .select("id, group_id")
              .in("group_id", groupIds)
          : Promise.resolve({ data: [] as never[] }),
      ]);

      for (const m of allGroupMembers ?? []) {
        const list = membersByGroup.get(m.group_id) ?? [];
        list.push(m.id);
        membersByGroup.set(m.group_id, list);
      }

      for (const item of items ?? []) {
        const list = itemsByReceipt.get(item.receipt_id) ?? [];
        list.push({
          id: item.id,
          name: item.name,
          quantity: Number(item.quantity),
          total_price: Number(item.total_price),
          split_mode: item.split_mode,
          split_n: item.split_n,
        });
        itemsByReceipt.set(item.receipt_id, list);
      }

      const itemIds = (items ?? []).map((i) => i.id);
      if (itemIds.length) {
        const { data: assignments } = await supabase
          .from("receipt_item_assignments")
          .select(
            "receipt_item_id, member_id, split_method, share_percentage, share_quantity, share_amount"
          )
          .in("receipt_item_id", itemIds);
        for (const a of assignments ?? []) {
          const list = assignmentsByItem.get(a.receipt_item_id) ?? [];
          list.push({
            member_id: a.member_id,
            split_method: a.split_method,
            share_percentage:
              a.share_percentage != null ? Number(a.share_percentage) : null,
            share_quantity:
              a.share_quantity != null ? Number(a.share_quantity) : null,
            share_amount: a.share_amount != null ? Number(a.share_amount) : null,
          });
          assignmentsByItem.set(a.receipt_item_id, list);
        }
      }
    }

    // Personal share per receipt (what you pay) + group rollups
    const monthMap = emptyMonths();
    const groupSpend = new Map<
      string,
      { name: string; receipts: number; spend: number }
    >();
    for (const m of memberships ?? []) {
      const g = m.groups as unknown as
        | { id: string; name: string }
        | { id: string; name: string }[]
        | null;
      const group = Array.isArray(g) ? g[0] : g;
      if (!group) continue;
      groupSpend.set(m.group_id, { name: group.name, receipts: 0, spend: 0 });
    }

    let personalSpend = 0;
    let receiptShareCount = 0;
    let tipSum = 0;
    let tipCount = 0;
    const merchantMap = new Map<string, { total: number; count: number }>();
    const catMap = new Map<string, number>();

    for (const r of allReceipts) {
      const myMemberId = r.group_id ? memberIdByGroup.get(r.group_id) : null;
      const items = itemsByReceipt.get(r.id) ?? [];
      let myShare = 0;

      if (myMemberId && items.length) {
        const memberIds = r.group_id
          ? membersByGroup.get(r.group_id) ?? [myMemberId]
          : [myMemberId];
        const splitItems: ItemSplitInput[] = items.map((item) => {
          const asg = assignmentsByItem.get(item.id) ?? [];
          return {
            itemId: item.id,
            itemName: item.name,
            itemTotal: item.total_price,
            itemQuantity: item.quantity,
            splitMode: (item.split_mode as ItemSplitMode) ?? "among_n",
            splitN: item.split_n,
            assignments: asg.map((a) => ({
              memberId: a.member_id,
              splitMethod: a.split_method,
              sharePercentage: a.share_percentage,
              shareQuantity: a.share_quantity,
              shareAmount: a.share_amount,
            })),
          };
        });
        const summary = computeSplitBalances(
          splitItems,
          {
            tax: r.tax,
            discount: r.discount,
            serviceCharge: r.service_charge,
            tip: r.tip,
          },
          {
            equalServiceChargeMemberIds: memberIds,
            groupMemberIds: memberIds,
          }
        );
        const share = summary.members.find((m) => m.memberId === myMemberId);
        myShare = share ? moneyNumber(share.total) : 0;
      } else if (r.group_id == null || !myMemberId) {
        // Solo receipt you created (no group) — count full total as yours
        const created = (createdRes.data ?? []).some((c) => c.id === r.id);
        if (created) myShare = moneyNumber(r.total);
      }

      if (myShare <= 0 && !(createdRes.data ?? []).some((c) => c.id === r.id)) {
        continue;
      }

      // For created receipts with no claim share yet, still count full total for merchant stats
      const spendAmount =
        myShare > 0
          ? myShare
          : (createdRes.data ?? []).some((c) => c.id === r.id)
            ? moneyNumber(r.total)
            : 0;
      if (spendAmount <= 0) continue;

      personalSpend = moneyNumber(personalSpend + spendAmount);
      receiptShareCount += 1;
      if (r.tip > 0) {
        tipSum += r.tip;
        tipCount += 1;
      }

      const key = format(new Date(r.created_at), "yyyy-MM");
      if (monthMap.has(key)) {
        const cur = monthMap.get(key)!;
        cur.spend = moneyNumber(cur.spend + spendAmount);
      }

      if (r.group_id && groupSpend.has(r.group_id) && myShare > 0) {
        const g = groupSpend.get(r.group_id)!;
        g.receipts += 1;
        g.spend = moneyNumber(g.spend + myShare);
      }

      const merchant = r.merchant?.trim() || "Unknown";
      const mCur = merchantMap.get(merchant) ?? { total: 0, count: 0 };
      mCur.total = moneyNumber(mCur.total + spendAmount);
      mCur.count += 1;
      merchantMap.set(merchant, mCur);

      const cat = categorizeMerchant(r.merchant);
      catMap.set(cat, moneyNumber((catMap.get(cat) ?? 0) + spendAmount));
    }

    // Confirmed payments into monthly chart + summary
    for (const p of confirmed.rows) {
      if (!p.paidAt) continue;
      const d = new Date(p.paidAt);
      if (d < sixMonthsAgo) continue;
      const key = format(d, "yyyy-MM");
      if (!monthMap.has(key)) continue;
      const cur = monthMap.get(key)!;
      if (p.direction === "received") {
        cur.payments = moneyNumber(cur.payments + p.amount);
      }
    }

    const monthlySpend = Array.from(monthMap.entries()).map(([month, v]) => ({
      month,
      label: format(new Date(`${month}-01`), "MMM yyyy"),
      total: v.spend,
      payments: v.payments,
    }));

    const topMerchants = Array.from(merchantMap.entries())
      .map(([name, v]) => ({
        name,
        total: v.total,
        count: v.count,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);

    const categories = Array.from(catMap.entries())
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total);

    const groupStats = Array.from(groupSpend.entries())
      .map(([id, v]) => ({
        id,
        name: v.name,
        receipts: v.receipts,
        spend: v.spend,
      }))
      .sort((a, b) => b.spend - a.spend);

    // Avg people per claimed item (from assignments on receipts you touch)
    let avgPeoplePerItem = 0;
    {
      const counts: number[] = [];
      for (const [, asg] of assignmentsByItem) {
        if (asg.length) counts.push(asg.length);
      }
      avgPeoplePerItem = counts.length
        ? moneyNumber(counts.reduce((s, n) => s + n, 0) / counts.length)
        : 0;
    }

    const avgReceipt = receiptShareCount
      ? moneyNumber(personalSpend / receiptShareCount)
      : 0;

    return ok({
      summary: {
        totalSpend: personalSpend,
        receiptCount: receiptShareCount,
        avgReceipt,
        finalizedCount: allReceipts.filter((r) => r.status === "finalized").length,
        avgTip: tipCount ? moneyNumber(tipSum / tipCount) : 0,
        avgPeoplePerItem,
        paymentsReceived: confirmed.totalReceived,
        paymentsSent: confirmed.totalSent,
        currency: "PHP",
      },
      monthlySpend,
      topMerchants,
      categories,
      groupStats,
      recentPayments: confirmed.rows.slice(0, 8),
    });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
