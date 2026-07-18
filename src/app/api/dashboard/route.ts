import { createClient } from "@/lib/supabase/server";
import { ok, unauthorized, serverError } from "@/lib/api";

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

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [
      receiptsRes,
      groupsRes,
      friendsRes,
      activitiesRes,
      monthlyRes,
      notificationsRes,
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
        .from("receipts")
        .select("total, created_at")
        .eq("created_by", user.id)
        .gte("created_at", startOfMonth),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .is("read_at", null),
    ]);

    const monthlySpend = (monthlyRes.data ?? []).reduce(
      (sum, r) => sum + Number(r.total ?? 0),
      0
    );

    const totalExpenses = (receiptsRes.data ?? []).reduce(
      (sum, r) => sum + Number(r.total ?? 0),
      0
    );

    // Build last 6 months series from receipts (best-effort)
    const months: { label: string; total: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        label: d.toLocaleString("en", { month: "short" }),
        total: 0,
      });
    }

    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const { data: chartReceipts } = await supabase
      .from("receipts")
      .select("total, created_at")
      .eq("created_by", user.id)
      .gte("created_at", sixMonthsAgo.toISOString());

    for (const r of chartReceipts ?? []) {
      const d = new Date(r.created_at);
      const idx =
        (d.getFullYear() - sixMonthsAgo.getFullYear()) * 12 +
        (d.getMonth() - sixMonthsAgo.getMonth());
      if (idx >= 0 && idx < months.length) {
        months[idx].total += Number(r.total ?? 0);
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

    return ok({
      stats: {
        totalExpenses,
        monthlySpend,
        groupsCount: groups.length,
        friendsCount: friendsRes.count ?? 0,
        unreadNotifications: notificationsRes.count ?? 0,
        mostActiveGroup: groups[0]?.name ?? null,
      },
      recentReceipts: receiptsRes.data ?? [],
      groups,
      activities: activitiesRes.data ?? [],
      monthlyChart: months,
    });
  } catch (error) {
    console.error(error);
    return serverError("Failed to load dashboard");
  }
}
