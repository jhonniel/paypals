import { getAuthedClient } from "@/lib/supabase/auth";
import { ok, unauthorized, serverError, fail } from "@/lib/api";
import { format, subMonths, startOfMonth } from "date-fns";

function categorizeMerchant(merchant: string | null): string {
  const m = (merchant ?? "").toLowerCase();
  if (/coffee|cafe|starbucks|dunkin|kopi/.test(m)) return "Coffee & cafes";
  if (/resto|restaurant|grill|kitchen|bistro|jollibee|mcdo|kfc|pizza|sushi/.test(m))
    return "Restaurants";
  if (/grocery|market|supermarket|sari|puregold|sm hyper|robinsons/.test(m))
    return "Groceries";
  if (/grab|uber|taxi|lrt|mrt|bus|petron|shell|caltex/.test(m)) return "Transport";
  if (/mall|uniqlo|zara|h&m|nike|adidas/.test(m)) return "Shopping";
  if (/pharmacy|mercury|watsons|clinic|hospital/.test(m)) return "Health";
  return "Other";
}

export async function GET() {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;

    const sixMonthsAgo = startOfMonth(subMonths(new Date(), 5)).toISOString();

    const { data: receipts, error } = await supabase
      .from("receipts")
      .select("id, merchant, total, currency, status, group_id, created_at, tip, tax")
      .eq("created_by", user.id)
      .gte("created_at", sixMonthsAgo)
      .order("created_at", { ascending: true });

    if (error) return fail(error.message, 400);

    const rows = receipts ?? [];

    // Monthly spend
    const monthMap = new Map<string, number>();
    for (let i = 5; i >= 0; i--) {
      const key = format(subMonths(new Date(), i), "yyyy-MM");
      monthMap.set(key, 0);
    }
    for (const r of rows) {
      const key = format(new Date(r.created_at), "yyyy-MM");
      if (monthMap.has(key)) {
        monthMap.set(key, (monthMap.get(key) ?? 0) + Number(r.total ?? 0));
      }
    }
    const monthlySpend = Array.from(monthMap.entries()).map(([month, total]) => ({
      month,
      label: format(new Date(`${month}-01`), "MMM yyyy"),
      total: Math.round(total * 100) / 100,
    }));

    // Top merchants
    const merchantMap = new Map<string, { total: number; count: number }>();
    for (const r of rows) {
      const name = r.merchant?.trim() || "Unknown";
      const cur = merchantMap.get(name) ?? { total: 0, count: 0 };
      cur.total += Number(r.total ?? 0);
      cur.count += 1;
      merchantMap.set(name, cur);
    }
    const topMerchants = Array.from(merchantMap.entries())
      .map(([name, v]) => ({
        name,
        total: Math.round(v.total * 100) / 100,
        count: v.count,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);

    // Categories
    const catMap = new Map<string, number>();
    for (const r of rows) {
      const cat = categorizeMerchant(r.merchant);
      catMap.set(cat, (catMap.get(cat) ?? 0) + Number(r.total ?? 0));
    }
    const categories = Array.from(catMap.entries())
      .map(([name, total]) => ({ name, total: Math.round(total * 100) / 100 }))
      .sort((a, b) => b.total - a.total);

    // Group stats
    const { data: memberships } = await supabase
      .from("group_members")
      .select("group_id, groups(id, name)")
      .eq("user_id", user.id);

    const groupIds = (memberships ?? []).map((m) => m.group_id);
    let groupStats: Array<{ id: string; name: string; receipts: number; spend: number }> = [];

    if (groupIds.length) {
      const { data: groupReceipts } = await supabase
        .from("receipts")
        .select("id, group_id, total, groups(name)")
        .in("group_id", groupIds)
        .gte("created_at", sixMonthsAgo);

      const gMap = new Map<string, { name: string; receipts: number; spend: number }>();
      for (const m of memberships ?? []) {
        const g = m.groups as unknown as { id: string; name: string } | { id: string; name: string }[] | null;
        const group = Array.isArray(g) ? g[0] : g;
        if (!group) continue;
        gMap.set(m.group_id, { name: group.name, receipts: 0, spend: 0 });
      }
      for (const r of groupReceipts ?? []) {
        if (!r.group_id) continue;
        const cur = gMap.get(r.group_id);
        if (!cur) continue;
        cur.receipts += 1;
        cur.spend += Number(r.total ?? 0);
      }
      groupStats = Array.from(gMap.entries())
        .map(([id, v]) => ({
          id,
          name: v.name,
          receipts: v.receipts,
          spend: Math.round(v.spend * 100) / 100,
        }))
        .sort((a, b) => b.spend - a.spend);
    }

    const totals = rows.reduce((s, r) => s + Number(r.total ?? 0), 0);
    const avgReceipt = rows.length ? totals / rows.length : 0;
    const finalized = rows.filter((r) => r.status === "finalized").length;
    const avgTip =
      rows.length > 0
        ? rows.reduce((s, r) => s + Number(r.tip ?? 0), 0) / rows.length
        : 0;

    // Average split: assignments / items across user's receipts
    const receiptIds = rows.map((r) => r.id);
    let avgSplitShare = 0;
    if (receiptIds.length) {
      const { data: items } = await supabase
        .from("receipt_items")
        .select("id")
        .in("receipt_id", receiptIds);
      const itemIds = (items ?? []).map((i) => i.id);
      if (itemIds.length) {
        const { data: assignments } = await supabase
          .from("receipt_item_assignments")
          .select("receipt_item_id")
          .in("receipt_item_id", itemIds);
        const byItem = new Map<string, number>();
        for (const a of assignments ?? []) {
          byItem.set(a.receipt_item_id, (byItem.get(a.receipt_item_id) ?? 0) + 1);
        }
        const counts = Array.from(byItem.values());
        avgSplitShare = counts.length
          ? counts.reduce((s, n) => s + n, 0) / counts.length
          : 0;
      }
    }

    return ok({
        summary: {
          totalSpend: Math.round(totals * 100) / 100,
          receiptCount: rows.length,
          avgReceipt: Math.round(avgReceipt * 100) / 100,
          finalizedCount: finalized,
          avgTip: Math.round(avgTip * 100) / 100,
          avgPeoplePerItem: Math.round(avgSplitShare * 100) / 100,
          currency: "PHP",
        },
        monthlySpend,
        topMerchants,
        categories,
        groupStats,
      });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
