"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowRight,
  BarChart3,
  Layers,
  Receipt,
  Shield,
  TrendingUp,
  Users,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { formatPHP } from "@/lib/money";

const PIE_COLORS = ["#0d7a62", "#2ee6a6", "#5a6b64", "#1a9b7a", "#94a3b8", "#0c1210", "#86efac"];

function chartLabel(value: string, max = 14) {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function ChartTooltip({
  active,
  payload,
  label,
  valueLabel = "Amount",
  formatValue = (v: number) => formatPHP(v),
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ value?: unknown; payload?: Record<string, unknown> }>;
  label?: string | number;
  valueLabel?: string;
  formatValue?: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload ?? {};
  return (
    <div className="rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-md">
      {label ? <p className="mb-1 font-medium">{String(label)}</p> : null}
      {payload.map((entry, i) => (
        <p key={i} className="tabular-nums">
          {valueLabel}: {formatValue(Number(entry.value ?? 0))}
        </p>
      ))}
      {"receipts" in row && typeof row.receipts === "number" ? (
        <p className="tabular-nums text-muted-foreground">Receipts: {row.receipts}</p>
      ) : null}
      {"count" in row && typeof row.count === "number" ? (
        <p className="tabular-nums text-muted-foreground">Count: {row.count}</p>
      ) : null}
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const tone =
    rank === 1
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
      : rank === 2
        ? "bg-slate-500/15 text-slate-700 dark:text-slate-300"
        : rank === 3
          ? "bg-orange-500/15 text-orange-700 dark:text-orange-400"
          : "bg-muted text-muted-foreground";

  return (
    <span
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${tone}`}
    >
      {rank}
    </span>
  );
}

type RankedUser = {
  rank: number;
  id: string;
  name: string;
  billShare: number;
  uploadTotal: number;
  receiptCount: number;
  shareReceiptCount: number;
  isGuest: boolean;
};

type RankedGroup = {
  rank: number;
  id: string;
  name: string;
  totalSpend: number;
  billShareTotal: number;
  receiptCount: number;
  memberCount: number;
};

type AnalyticsData = {
  summary: {
    totalSpend: number;
    receiptCount: number;
    userCount: number;
    avgReceipt: number;
    finalizedCount: number;
    avgTip: number;
    currency: string;
    systemTotals: {
      totalReceipts: number;
      groupReceipts: number;
      soloReceipts: number;
      totalGroups: number;
      totalUsers: number;
      usersWithReceipts: number;
      uniqueMerchants: number;
      totalBillShare: number;
      receiptsByStatus: Record<string, number>;
    };
  };
  monthlySpend: Array<{
    month: string;
    label: string;
    total: number;
    receipts: number;
  }>;
  topMerchants: Array<{ name: string; total: number; count: number }>;
  categories: Array<{ name: string; total: number }>;
  rankedUsersByShare: RankedUser[];
  rankedUsersByUpload: RankedUser[];
  rankedGroups: RankedGroup[];
  recentReceipts: Array<{
    id: string;
    merchant: string | null;
    total: number;
    currency: string;
    status: string;
    createdAt: string;
    createdBy: string | null;
    creatorName: string | null;
    ocrConfidence: number | null;
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
            {error instanceof Error ? error.message : "Could not load platform analytics."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { summary } = data;
  const system = summary.systemTotals;
  const stats = [
    {
      label: "All receipts (system)",
      value: String(system.totalReceipts),
      icon: Receipt,
    },
    {
      label: "Total platform spend",
      value: formatPHP(summary.totalSpend, summary.currency),
      icon: TrendingUp,
    },
    {
      label: "All users",
      value: String(system.totalUsers),
      icon: Users,
    },
    {
      label: "All groups",
      value: String(system.totalGroups),
      icon: Layers,
    },
  ];

  const hasAnyData = summary.receiptCount > 0;

  const receiptStatusChart = Object.entries(system.receiptsByStatus)
    .map(([name, count]) => ({
      name: name.replaceAll("_", " "),
      count,
    }))
    .sort((a, b) => b.count - a.count);

  const receiptTypeChart = [
    { name: "In groups", value: system.groupReceipts, fill: "#0d7a62" },
    { name: "Solo", value: system.soloReceipts, fill: "#2ee6a6" },
  ].filter((d) => d.value > 0);

  const topUsersShareChart = data.rankedUsersByShare.slice(0, 8).map((u) => ({
    name: chartLabel(u.name, 16),
    total: u.billShare,
  }));

  const topUsersUploadChart = data.rankedUsersByUpload.slice(0, 8).map((u) => ({
    name: chartLabel(u.name, 16),
    total: u.uploadTotal,
  }));

  const topGroupsChart = data.rankedGroups.slice(0, 8).map((g) => ({
    name: chartLabel(g.name, 18),
    total: g.totalSpend,
    receipts: g.receiptCount,
  }));

  const categoryBarChart = data.categories.slice(0, 8).map((c) => ({
    name: chartLabel(c.name, 18),
    total: c.total,
  }));

  const merchantCountChart = data.topMerchants.slice(0, 8).map((m) => ({
    name: chartLabel(m.name, 18),
    count: m.count,
    total: m.total,
  }));

  return (
    <div className="space-y-6 sm:space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          System-wide dashboard — every receipt, user, group, merchant, and bill share
          across the entire platform. Admin only.
        </p>
      </div>

      {!hasAnyData ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">
              No receipts in the system yet. Totals will update as any user uploads
              receipts.
            </p>
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

      <Card>
        <CardHeader>
          <CardTitle>System totals</CardTitle>
          <CardDescription>
            Aggregated counts from all users — not scoped to any single account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
              <p className="text-xs text-muted-foreground">Receipts in groups</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {system.groupReceipts}
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
              <p className="text-xs text-muted-foreground">Solo receipts</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {system.soloReceipts}
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
              <p className="text-xs text-muted-foreground">Users with receipts</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {system.usersWithReceipts}
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
              <p className="text-xs text-muted-foreground">Unique merchants</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {system.uniqueMerchants}
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
              <p className="text-xs text-muted-foreground">Total bill share assigned</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {formatPHP(system.totalBillShare, summary.currency)}
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
              <p className="text-xs text-muted-foreground">Finalized receipts</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {summary.finalizedCount}
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
              <p className="text-xs text-muted-foreground">Avg receipt total</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {formatPHP(summary.avgReceipt, summary.currency)}
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Shield className="h-3 w-3" /> Receipt statuses
              </p>
              <p className="mt-1 text-sm font-medium leading-relaxed text-foreground">
                {Object.entries(system.receiptsByStatus)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 4)
                  .map(([status, count]) => `${count} ${status.replaceAll("_", " ")}`)
                  .join(" · ") || "—"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle>Monthly system activity</CardTitle>
            <CardDescription>
              All receipts from every user — spend and receipt count (last 6 months).
            </CardDescription>
          </CardHeader>
          <CardContent className="h-64 sm:h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data.monthlySpend}>
                <defs>
                  <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0d7a62" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#0d7a62" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis
                  yAxisId="spend"
                  tick={{ fontSize: 11 }}
                  width={48}
                  tickFormatter={(v) =>
                    Number(v) >= 1000 ? `${Math.round(Number(v) / 1000)}k` : String(v)
                  }
                />
                <YAxis
                  yAxisId="count"
                  orientation="right"
                  tick={{ fontSize: 11 }}
                  width={32}
                  allowDecimals={false}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload as {
                      total: number;
                      receipts: number;
                    };
                    return (
                      <div className="rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-md">
                        <p className="mb-1 font-medium">{label}</p>
                        <p className="tabular-nums">
                          Spend: {formatPHP(row.total ?? 0)}
                        </p>
                        <p className="tabular-nums text-muted-foreground">
                          Receipts: {row.receipts ?? 0}
                        </p>
                      </div>
                    );
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11 }}
                  formatter={(value) =>
                    value === "total" ? "Spend" : value === "receipts" ? "Receipts" : value
                  }
                />
                <Area
                  yAxisId="spend"
                  type="monotone"
                  dataKey="total"
                  name="total"
                  stroke="#0d7a62"
                  fill="url(#spendFill)"
                  strokeWidth={2}
                />
                <Bar
                  yAxisId="count"
                  dataKey="receipts"
                  name="receipts"
                  fill="#5b8def"
                  radius={[4, 4, 0, 0]}
                  barSize={18}
                  opacity={0.85}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Categories</CardTitle>
            <CardDescription>All system receipts — inferred from merchant names.</CardDescription>
          </CardHeader>
          <CardContent className="h-64 sm:h-72">
            {data.categories.length === 0 ? (
              <p className="text-sm text-muted-foreground">No category data yet.</p>
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

      <div>
        <h2 className="mb-4 text-lg font-semibold tracking-tight">More graphs</h2>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Monthly receipt count</CardTitle>
              <CardDescription>
                Number of receipts uploaded system-wide each month.
              </CardDescription>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.monthlySpend}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={32} allowDecimals={false} />
                  <Tooltip
                    content={(props) => (
                      <ChartTooltip
                        active={props.active}
                        payload={props.payload}
                        label={props.label}
                        valueLabel="Receipts"
                        formatValue={(v) => String(v)}
                      />
                    )}
                  />
                  <Bar dataKey="receipts" fill="#5b8def" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Receipt status breakdown</CardTitle>
              <CardDescription>All receipts by workflow status.</CardDescription>
            </CardHeader>
            <CardContent className="h-64">
              {receiptStatusChart.length === 0 ? (
                <p className="text-sm text-muted-foreground">No status data yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={receiptStatusChart}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 10 }}
                      interval={0}
                      angle={-25}
                      textAnchor="end"
                      height={56}
                    />
                    <YAxis tick={{ fontSize: 11 }} width={32} allowDecimals={false} />
                    <Tooltip
                      content={(props) => (
                        <ChartTooltip
                          active={props.active}
                          payload={props.payload}
                          label={props.label}
                          valueLabel="Receipts"
                          formatValue={(v) => String(v)}
                        />
                      )}
                    />
                    <Bar dataKey="count" fill="#1a9b7a" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Group vs solo receipts</CardTitle>
              <CardDescription>Share of receipts tied to groups vs personal.</CardDescription>
            </CardHeader>
            <CardContent className="h-64">
              {receiptTypeChart.length === 0 ? (
                <p className="text-sm text-muted-foreground">No receipt type data yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={receiptTypeChart}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={52}
                      outerRadius={82}
                      paddingAngle={3}
                      label={({ name, value }) => `${name}: ${value}`}
                    >
                      {receiptTypeChart.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => String(v ?? 0)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Category spend</CardTitle>
              <CardDescription>Top categories by total receipt spend.</CardDescription>
            </CardHeader>
            <CardContent className="h-64">
              {categoryBarChart.length === 0 ? (
                <p className="text-sm text-muted-foreground">No category data yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categoryBarChart} layout="vertical" margin={{ left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={100}
                      tick={{ fontSize: 10 }}
                    />
                    <Tooltip content={(props) => <ChartTooltip active={props.active} payload={props.payload} label={props.label} />} />
                    <Bar dataKey="total" fill="#2ee6a6" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top users — bill share</CardTitle>
              <CardDescription>Highest assigned shares across the platform.</CardDescription>
            </CardHeader>
            <CardContent className="h-64">
              {topUsersShareChart.length === 0 ? (
                <p className="text-sm text-muted-foreground">No share data yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topUsersShareChart} layout="vertical" margin={{ left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={100}
                      tick={{ fontSize: 10 }}
                    />
                    <Tooltip content={(props) => <ChartTooltip active={props.active} payload={props.payload} label={props.label} />} />
                    <Bar dataKey="total" fill="#0d7a62" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top users — uploads</CardTitle>
              <CardDescription>Most receipt upload volume by user.</CardDescription>
            </CardHeader>
            <CardContent className="h-64">
              {topUsersUploadChart.length === 0 ? (
                <p className="text-sm text-muted-foreground">No upload data yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topUsersUploadChart} layout="vertical" margin={{ left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={100}
                      tick={{ fontSize: 10 }}
                    />
                    <Tooltip content={(props) => <ChartTooltip active={props.active} payload={props.payload} label={props.label} />} />
                    <Bar dataKey="total" fill="#5b8def" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top groups — spend</CardTitle>
              <CardDescription>Groups with the highest receipt totals.</CardDescription>
            </CardHeader>
            <CardContent className="h-64">
              {topGroupsChart.length === 0 ? (
                <p className="text-sm text-muted-foreground">No group data yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topGroupsChart} layout="vertical" margin={{ left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={100}
                      tick={{ fontSize: 10 }}
                    />
                    <Tooltip content={(props) => <ChartTooltip active={props.active} payload={props.payload} label={props.label} />} />
                    <Bar dataKey="total" fill="#f0b429" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Merchant visit frequency</CardTitle>
              <CardDescription>How often each top merchant appears on receipts.</CardDescription>
            </CardHeader>
            <CardContent className="h-64">
              {merchantCountChart.length === 0 ? (
                <p className="text-sm text-muted-foreground">No merchant data yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={merchantCountChart}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 10 }}
                      interval={0}
                      angle={-25}
                      textAnchor="end"
                      height={56}
                    />
                    <YAxis tick={{ fontSize: 11 }} width={32} allowDecimals={false} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const row = payload[0]?.payload as { count: number; total: number };
                        return (
                          <div className="rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-md">
                            <p className="mb-1 font-medium">{label}</p>
                            <p className="tabular-nums">Visits: {row.count}</p>
                            <p className="tabular-nums text-muted-foreground">
                              Spend: {formatPHP(row.total)}
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="count" fill="#e85d75" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top merchants</CardTitle>
            <CardDescription>Highest total spend across all receipts.</CardDescription>
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
              <Users className="h-4 w-4" /> User ranking — bill share
            </CardTitle>
            <CardDescription>
              Ranked by total assigned share across all receipts and groups.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.rankedUsersByShare.length === 0 ? (
              <p className="text-sm text-muted-foreground">No bill share data yet.</p>
            ) : (
              <ul className="space-y-3">
                {data.rankedUsersByShare.map((u) => (
                  <li
                    key={`share-${u.id}`}
                    className="flex items-center gap-3 border-b border-border/60 pb-3 last:border-0 last:pb-0"
                  >
                    <RankBadge rank={u.rank} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {u.name}
                        {u.isGuest ? (
                          <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                            guest
                          </span>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {u.shareReceiptCount} receipt{u.shareReceiptCount === 1 ? "" : "s"}{" "}
                        with share
                        {u.uploadTotal > 0
                          ? ` · ${formatPHP(u.uploadTotal, summary.currency)} uploaded`
                          : ""}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums text-primary">
                      {formatPHP(u.billShare, summary.currency)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="h-4 w-4" /> User ranking — uploads
            </CardTitle>
            <CardDescription>
              Ranked by total receipt amounts uploaded to the platform.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.rankedUsersByUpload.length === 0 ? (
              <p className="text-sm text-muted-foreground">No upload data yet.</p>
            ) : (
              <ul className="space-y-3">
                {data.rankedUsersByUpload.map((u) => (
                  <li
                    key={`upload-${u.id}`}
                    className="flex items-center gap-3 border-b border-border/60 pb-3 last:border-0 last:pb-0"
                  >
                    <RankBadge rank={u.rank} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{u.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {u.receiptCount} receipt{u.receiptCount === 1 ? "" : "s"} uploaded
                        {u.billShare > 0
                          ? ` · ${formatPHP(u.billShare, summary.currency)} share`
                          : ""}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums">
                      {formatPHP(u.uploadTotal, summary.currency)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" /> Group ranking
            </CardTitle>
            <CardDescription>
              Ranked by total receipt volume and assigned bill shares.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.rankedGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">No group activity yet.</p>
            ) : (
              <ul className="space-y-3">
                {data.rankedGroups.map((g) => (
                  <li
                    key={g.id}
                    className="flex items-center gap-3 border-b border-border/60 pb-3 last:border-0 last:pb-0"
                  >
                    <RankBadge rank={g.rank} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{g.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {g.receiptCount} receipt{g.receiptCount === 1 ? "" : "s"} ·{" "}
                        {g.memberCount} member{g.memberCount === 1 ? "" : "s"}
                        {g.billShareTotal > 0
                          ? ` · ${formatPHP(g.billShareTotal, summary.currency)} assigned`
                          : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <p className="text-sm font-semibold tabular-nums">
                        {formatPHP(g.totalSpend, summary.currency)}
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-4 w-4" /> Recent receipts
          </CardTitle>
          <CardDescription>Latest tracked receipts across all users.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.recentReceipts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No receipts yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.recentReceipts.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-3 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {r.merchant?.trim() || "Untitled receipt"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.creatorName ?? "Unknown user"}
                      {r.createdAt
                        ? ` · ${formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}`
                        : ""}
                      {r.status ? ` · ${r.status}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-semibold tabular-nums">
                      {formatPHP(r.total, r.currency)}
                    </span>
                    <Button variant="ghost" size="sm" asChild className="h-8 px-2">
                      <Link href={`/receipts/${r.id}`}>
                        View <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Avg tip on all receipts</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {formatPHP(summary.avgTip, summary.currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <BarChart3 className="h-3 w-3" /> Merchants tracked (system)
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {system.uniqueMerchants}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
