import { getAdminClient, getAuthedClient } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, unauthorized, forbidden, serverError } from "@/lib/api";
import { moneyNumber } from "@/lib/money";
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
  const monthMap = new Map<string, { spend: number; receipts: number }>();
  for (let i = 5; i >= 0; i--) {
    const key = format(subMonths(new Date(), i), "yyyy-MM");
    monthMap.set(key, { spend: 0, receipts: 0 });
  }
  return monthMap;
}

function withRank<T extends Record<string, unknown>>(
  rows: T[],
  start = 1
): Array<T & { rank: number }> {
  return rows.map((row, index) => ({ ...row, rank: start + index }));
}

type UserSpendAcc = {
  name: string;
  billShare: number;
  uploadTotal: number;
  receiptCount: number;
  shareReceiptCount: number;
  isGuest: boolean;
};

type GroupSpendAcc = {
  name: string;
  totalSpend: number;
  billShareTotal: number;
  receiptCount: number;
  memberCount: number;
};

export async function GET() {
  try {
    const auth = await getAdminClient();
    if (!auth) {
      const base = await getAuthedClient();
      if (!base) return unauthorized();
      return forbidden("Admin access required");
    }

    const reader = process.env.SUPABASE_SERVICE_ROLE_KEY
      ? createAdminClient()
      : auth.supabase;

    const sixMonthsAgo = startOfMonth(subMonths(new Date(), 5)).toISOString();

    const [usersCount, allReceiptsRes, recentReceiptsRes, profilesRes, membersRes, groupsRes] =
      await Promise.all([
        reader.from("profiles").select("id", { count: "exact", head: true }),
        reader
          .from("receipts")
          .select(
            "id, merchant, total, currency, status, created_at, created_by, tip, tax, discount, service_charge, group_id"
          )
          .order("created_at", { ascending: true }),
        reader
          .from("receipts")
          .select(
            "id, merchant, total, currency, status, created_at, created_by, ocr_confidence"
          )
          .order("created_at", { ascending: false })
          .limit(40),
        reader.from("profiles").select("id, full_name, email, username"),
        reader
          .from("group_members")
          .select("id, user_id, guest_name, group_id"),
        reader.from("groups").select("id, name"),
      ]);

    if (allReceiptsRes.error) {
      console.error(allReceiptsRes.error);
      return serverError();
    }

    const profileById = new Map(
      (profilesRes.data ?? []).map((p) => [
        p.id,
        p.full_name?.trim() || p.username?.trim() || p.email || "Unknown user",
      ])
    );

    const allReceipts = allReceiptsRes.data ?? [];
    const receiptIds = allReceipts.map((r) => r.id);

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

    if (receiptIds.length) {
      const { data: items } = await reader
        .from("receipt_items")
        .select("id, receipt_id, name, quantity, total_price, split_mode, split_n")
        .in("receipt_id", receiptIds);

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
        const { data: assignments } = await reader
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

    const membersByGroup = new Map<string, string[]>();
    const memberInfo = new Map<
      string,
      { userId: string | null; guestName: string | null; groupId: string }
    >();

    for (const m of membersRes.data ?? []) {
      const list = membersByGroup.get(m.group_id) ?? [];
      list.push(m.id);
      membersByGroup.set(m.group_id, list);
      memberInfo.set(m.id, {
        userId: m.user_id,
        guestName: m.guest_name,
        groupId: m.group_id,
      });
    }

    const groupAcc = new Map<string, GroupSpendAcc>();
    for (const g of groupsRes.data ?? []) {
      groupAcc.set(g.id, {
        name: g.name,
        totalSpend: 0,
        billShareTotal: 0,
        receiptCount: 0,
        memberCount: membersByGroup.get(g.id)?.length ?? 0,
      });
    }

    const userSpendAcc = new Map<string, UserSpendAcc>();
    const shareReceiptSeen = new Set<string>();

    function userKeyForMember(memberId: string): string | null {
      const info = memberInfo.get(memberId);
      if (!info) return null;
      return info.userId ?? `member:${memberId}`;
    }

    function displayNameForKey(key: string, memberId?: string): string {
      if (!key.startsWith("member:")) {
        return profileById.get(key) ?? "Unknown user";
      }
      const mid = memberId ?? key.replace("member:", "");
      const info = memberInfo.get(mid);
      return info?.guestName?.trim() || "Guest seat";
    }

    function ensureUserAcc(key: string, memberId?: string): UserSpendAcc {
      const existing = userSpendAcc.get(key);
      if (existing) return existing;
      const acc: UserSpendAcc = {
        name: displayNameForKey(key, memberId),
        billShare: 0,
        uploadTotal: 0,
        receiptCount: 0,
        shareReceiptCount: 0,
        isGuest: key.startsWith("member:"),
      };
      userSpendAcc.set(key, acc);
      return acc;
    }

    function addBillShare(memberId: string, amount: number, receiptId: string) {
      const key = userKeyForMember(memberId);
      if (!key) return;
      const acc = ensureUserAcc(key, memberId);
      acc.billShare = moneyNumber(acc.billShare + amount);
      const receiptKey = `${key}:${receiptId}`;
      if (!shareReceiptSeen.has(receiptKey)) {
        acc.shareReceiptCount += 1;
        shareReceiptSeen.add(receiptKey);
      }
    }

    const monthMap = emptyMonths();
    const merchantMap = new Map<string, { total: number; count: number }>();
    const catMap = new Map<string, number>();

    let totalSpend = 0;
    let tipSum = 0;
    let tipCount = 0;
    let finalizedCount = 0;
    let groupReceiptCount = 0;
    let soloReceiptCount = 0;
    const statusCounts = new Map<string, number>();
    const usersWithReceipts = new Set<string>();

    for (const r of allReceipts) {
      const amount = moneyNumber(Number(r.total ?? 0));
      totalSpend = moneyNumber(totalSpend + amount);

      if (r.status === "finalized") finalizedCount += 1;
      statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);

      if (r.group_id) groupReceiptCount += 1;
      else soloReceiptCount += 1;

      const tip = Number(r.tip ?? 0);
      if (tip > 0) {
        tipSum += tip;
        tipCount += 1;
      }

      if (r.created_by) {
        usersWithReceipts.add(r.created_by);
        const acc = ensureUserAcc(r.created_by);
        acc.uploadTotal = moneyNumber(acc.uploadTotal + amount);
        acc.receiptCount += 1;
      }

      const merchant = r.merchant?.trim() || "Unknown";
      const mCur = merchantMap.get(merchant) ?? { total: 0, count: 0 };
      mCur.total = moneyNumber(mCur.total + amount);
      mCur.count += 1;
      merchantMap.set(merchant, mCur);

      const cat = categorizeMerchant(r.merchant);
      catMap.set(cat, moneyNumber((catMap.get(cat) ?? 0) + amount));

      const createdAt = r.created_at;
      if (createdAt && createdAt >= sixMonthsAgo) {
        const key = format(new Date(createdAt), "yyyy-MM");
        if (monthMap.has(key)) {
          const cur = monthMap.get(key)!;
          cur.spend = moneyNumber(cur.spend + amount);
          cur.receipts += 1;
        }
      }

      if (r.group_id) {
        const group = groupAcc.get(r.group_id);
        if (group) {
          group.totalSpend = moneyNumber(group.totalSpend + amount);
          group.receiptCount += 1;
        }

        const memberIds = membersByGroup.get(r.group_id) ?? [];
        const items = itemsByReceipt.get(r.id) ?? [];

        if (memberIds.length && items.length) {
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
              tax: Number(r.tax ?? 0),
              discount: Number(r.discount ?? 0),
              serviceCharge: Number(r.service_charge ?? 0),
              tip: Number(r.tip ?? 0),
            },
            {
              equalServiceChargeMemberIds: memberIds,
              groupMemberIds: memberIds,
            }
          );

          for (const share of summary.members) {
            if (share.total <= 0) continue;
            addBillShare(share.memberId, share.total, r.id);
            if (group) {
              group.billShareTotal = moneyNumber(group.billShareTotal + share.total);
            }
          }
        }
      } else if (r.created_by) {
        const acc = ensureUserAcc(r.created_by);
        acc.billShare = moneyNumber(acc.billShare + amount);
        const receiptKey = `${r.created_by}:${r.id}`;
        if (!shareReceiptSeen.has(receiptKey)) {
          acc.shareReceiptCount += 1;
          shareReceiptSeen.add(receiptKey);
        }
      }
    }

    const receiptCount = allReceipts.length;
    const avgReceipt = receiptCount ? moneyNumber(totalSpend / receiptCount) : 0;
    const totalBillShare = moneyNumber(
      Array.from(userSpendAcc.values()).reduce((sum, u) => sum + u.billShare, 0)
    );

    const monthlySpend = Array.from(monthMap.entries()).map(([month, v]) => ({
      month,
      label: format(new Date(`${month}-01`), "MMM yyyy"),
      total: v.spend,
      receipts: v.receipts,
    }));

    const topMerchants = Array.from(merchantMap.entries())
      .map(([name, v]) => ({
        name,
        total: v.total,
        count: v.count,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    const categories = Array.from(catMap.entries())
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total);

    const userRows = Array.from(userSpendAcc.entries()).map(([id, v]) => ({
      id,
      name: v.name,
      billShare: v.billShare,
      uploadTotal: v.uploadTotal,
      receiptCount: v.receiptCount,
      shareReceiptCount: v.shareReceiptCount,
      isGuest: v.isGuest,
    }));

    const rankedUsersByShare = withRank(
      userRows
        .filter((u) => u.billShare > 0)
        .sort((a, b) => b.billShare - a.billShare)
        .slice(0, 20)
    );

    const rankedUsersByUpload = withRank(
      userRows
        .filter((u) => u.uploadTotal > 0)
        .sort((a, b) => b.uploadTotal - a.uploadTotal)
        .slice(0, 20)
    );

    const rankedGroups = withRank(
      Array.from(groupAcc.entries())
        .map(([id, v]) => ({
          id,
          name: v.name,
          totalSpend: v.totalSpend,
          billShareTotal: v.billShareTotal,
          receiptCount: v.receiptCount,
          memberCount: v.memberCount,
        }))
        .filter((g) => g.totalSpend > 0 || g.receiptCount > 0)
        .sort((a, b) => b.totalSpend - a.totalSpend)
        .slice(0, 20)
    );

    const recentReceipts = (recentReceiptsRes.data ?? []).map((r) => ({
      id: r.id,
      merchant: r.merchant,
      total: moneyNumber(Number(r.total ?? 0)),
      currency: r.currency || "PHP",
      status: r.status,
      createdAt: r.created_at,
      createdBy: r.created_by,
      creatorName: r.created_by ? profileById.get(r.created_by) ?? null : null,
      ocrConfidence:
        r.ocr_confidence != null ? Number(r.ocr_confidence) : null,
    }));

    return ok({
      summary: {
        totalSpend,
        receiptCount,
        userCount: usersCount.count ?? 0,
        avgReceipt,
        finalizedCount,
        avgTip: tipCount ? moneyNumber(tipSum / tipCount) : 0,
        currency: "PHP",
        systemTotals: {
          totalReceipts: receiptCount,
          groupReceipts: groupReceiptCount,
          soloReceipts: soloReceiptCount,
          totalGroups: groupsRes.data?.length ?? 0,
          totalUsers: usersCount.count ?? 0,
          usersWithReceipts: usersWithReceipts.size,
          uniqueMerchants: merchantMap.size,
          totalBillShare,
          receiptsByStatus: Object.fromEntries(statusCounts.entries()),
        },
      },
      monthlySpend,
      topMerchants,
      categories,
      rankedUsersByShare,
      rankedUsersByUpload,
      rankedGroups,
      recentReceipts,
    });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
