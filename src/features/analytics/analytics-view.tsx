"use client";

import Link from "next/link";
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
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Receipt,
  Split,
  TrendingUp,
  Users,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
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
    paymentsReceived: number;
    paymentsSent: number;
    currency: string;
  };
  monthlySpend: Array<{
    month: string;
    label: string;
    total: number;
    payments?: number;
  }>;
  topMerchants: Array<{ name: string; total: number; count: number }>;
  categories: Array<{ name: string; total: number }>;
  groupStats: Array<{ id: string; name: string; receipts: number; spend: number }>;
  recentPayments?: Array<{
    id: string;
    groupId: string;
    groupName: string;
    fromName: string;
    toName: string | null;
    amount: number;
    currency: string;
    paidAt: string | null;
    direction: "received" | "sent";
  }>;
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
      label: "Your 6-month share",
      value: formatPHP(summary.totalSpend, summary.currency),
      icon: TrendingUp,
    },
    {
      label: "Receipts counted",
      value: String(summary.receiptCount),
      icon: Receipt,
    },
    {
      label: "Payments received",
      value: formatPHP(summary.paymentsReceived ?? 0, summary.currency),
      icon: BadgeCheck,
    },
    {
      label: "Payments sent",
      value: formatPHP(summary.paymentsSent ?? 0, summary.currency),
      icon: Split,
    },
  ];

  const recentPayments = data.recentPayments ?? [];
  const hasAnyData =
    summary.receiptCount > 0 ||
    summary.paymentsReceived > 0 ||
    summary.paymentsSent > 0 ||
    data.groupStats.some((g) => g.spend > 0);

  return (
    <div className="space-y-6 sm:space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your split shares, confirmed payments, and group activity over the last six
          months.
        </p>
      </div>

      {!hasAnyData ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-6">
            <p className="text-sm text-muted-foreground">
              No analytics yet. Upload a receipt, claim items in a group, or confirm a
              payment proof to see data here.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/receipts/new">Upload receipt</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/groups">Open groups</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

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
            <CardTitle>Monthly activity</CardTitle>
            <CardDescription>
              Your share of bills (teal) and payments you received (green).
            </CardDescription>
          </CardHeader>
          <CardContent className="h-64 sm:h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.monthlySpend}>
                <defs>
                  <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0d7a62" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#0d7a62" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="payFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={48} />
                <Tooltip
                  formatter={(v, name) => [
                    formatPHP(Number(v ?? 0)),
                    name === "payments" ? "Payments received" : "Your share",
                  ]}
                  contentStyle={{ borderRadius: 12, border: "1px solid var(--border)" }}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="#0d7a62"
                  fill="url(#spendFill)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="payments"
                  stroke="#10b981"
                  fill="url(#payFill)"
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
              <p className="text-sm text-muted-foreground">
                Claim items or upload receipts to see categories.
              </p>
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

      {recentPayments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BadgeCheck className="h-4 w-4" /> Confirmed payments
            </CardTitle>
            <CardDescription>
              Verified proof amounts from your groups.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {recentPayments.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {p.direction === "received"
                        ? `${p.fromName} paid you`
                        : `You paid ${p.toName ?? "payer"}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {p.groupName}
                      {p.paidAt
                        ? ` · ${formatDistanceToNow(new Date(p.paidAt), { addSuffix: true })}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={
                        p.direction === "received"
                          ? "font-semibold tabular-nums text-emerald-600 dark:text-emerald-400"
                          : "font-semibold tabular-nums"
                      }
                    >
                      {p.direction === "received" ? "+" : "−"}
                      {formatPHP(p.amount, p.currency)}
                    </span>
                    <Button variant="ghost" size="sm" asChild className="h-8 px-2">
                      <Link href={`/groups/${p.groupId}`}>
                        View <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top merchants</CardTitle>
            <CardDescription>Where your share adds up most.</CardDescription>
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
            <CardDescription>Your share across groups.</CardDescription>
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
                      <p className="text-xs text-muted-foreground">
                        {g.receipts} receipt{g.receipts === 1 ? "" : "s"} with your share
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <p className="text-sm font-semibold tabular-nums">
                        {formatPHP(g.spend)}
                      </p>
                      <Button variant="ghost" size="sm" asChild className="h-8 px-2">
                        <Link href={`/groups/${g.id}`}>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Avg share / receipt</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {formatPHP(summary.avgReceipt, summary.currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Avg tip on receipts</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {formatPHP(summary.avgTip, summary.currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <BarChart3 className="h-3 w-3" /> Avg people / item
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {summary.avgPeoplePerItem ? summary.avgPeoplePerItem.toFixed(1) : "—"}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
