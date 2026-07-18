"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, Receipt, Split, TrendingUp, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPHP } from "@/lib/money";

const PIE_COLORS = ["#0d7a62", "#2ee6a6", "#5a6b64", "#1a9b7a", "#94a3b8", "#0c1210", "#86efac"];

type AnalyticsData = {
  summary: {
    totalSpend: number;
    receiptCount: number;
    avgReceipt: number;
    finalizedCount: number;
    avgTip: number;
    avgPeoplePerItem: number;
    currency: string;
  };
  monthlySpend: Array<{ month: string; label: string; total: number }>;
  topMerchants: Array<{ name: string; total: number; count: number }>;
  categories: Array<{ name: string; total: number }>;
  groupStats: Array<{ id: string; name: string; receipts: number; spend: number }>;
};

export function AnalyticsView() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["analytics"],
    queryFn: async () => {
      const res = await fetch("/api/analytics");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load analytics");
      return json.data as AnalyticsData;
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-56" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Analytics unavailable</CardTitle>
          <CardDescription>
            {error instanceof Error ? error.message : "Could not load spending insights."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { summary } = data;
  const stats = [
    {
      label: "6-month spend",
      value: formatPHP(summary.totalSpend, summary.currency),
      icon: TrendingUp,
    },
    {
      label: "Receipts",
      value: String(summary.receiptCount),
      icon: Receipt,
    },
    {
      label: "Avg receipt",
      value: formatPHP(summary.avgReceipt, summary.currency),
      icon: BarChart3,
    },
    {
      label: "Avg people / item",
      value: summary.avgPeoplePerItem ? summary.avgPeoplePerItem.toFixed(1) : "—",
      icon: Split,
    },
  ];

  return (
    <div className="space-y-6 sm:space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Spending trends, merchants, and group activity over the last six months.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <Card>
              <CardContent className="flex items-start gap-3 p-4 sm:p-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                  <s.icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="truncate text-lg font-semibold tabular-nums">{s.value}</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle>Monthly spending</CardTitle>
            <CardDescription>Total of receipts you created.</CardDescription>
          </CardHeader>
          <CardContent className="h-64 sm:h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.monthlySpend}>
                <defs>
                  <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0d7a62" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#0d7a62" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={48} />
                <Tooltip
                  formatter={(v) => formatPHP(Number(v ?? 0))}
                  contentStyle={{ borderRadius: 12, border: "1px solid var(--border)" }}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="#0d7a62"
                  fill="url(#spendFill)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Categories</CardTitle>
            <CardDescription>Inferred from merchant names.</CardDescription>
          </CardHeader>
          <CardContent className="h-64 sm:h-72">
            {data.categories.length === 0 ? (
              <p className="text-sm text-muted-foreground">Upload receipts to see categories.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.categories}
                    dataKey="total"
                    nameKey="name"
                    innerRadius={48}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {data.categories.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => formatPHP(Number(v ?? 0))} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top merchants</CardTitle>
            <CardDescription>Where you spend the most.</CardDescription>
          </CardHeader>
          <CardContent className="h-64">
            {data.topMerchants.length === 0 ? (
              <p className="text-sm text-muted-foreground">No merchant data yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.topMerchants} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={90}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip formatter={(v) => formatPHP(Number(v ?? 0))} />
                  <Bar dataKey="total" fill="#0d7a62" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" /> Group activity
            </CardTitle>
            <CardDescription>Spend across your groups.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.groupStats.length === 0 ? (
              <p className="text-sm text-muted-foreground">Join a group to see stats.</p>
            ) : (
              <ul className="space-y-3">
                {data.groupStats.map((g) => (
                  <li
                    key={g.id}
                    className="flex items-center justify-between gap-3 border-b border-border/60 pb-3 last:border-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{g.name}</p>
                      <p className="text-xs text-muted-foreground">{g.receipts} receipts</p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums">
                      {formatPHP(g.spend)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
