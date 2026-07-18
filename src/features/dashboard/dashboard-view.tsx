"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Receipt,
  Users,
  UserPlus,
  TrendingUp,
  Upload,
  ArrowRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useDashboard } from "@/hooks/use-dashboard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function money(value: number, currency = "PHP") {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function DashboardView() {
  const { data, isLoading, error } = useDashboard();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
          <CardTitle>Couldn’t load dashboard</CardTitle>
          <CardDescription>
            {error instanceof Error ? error.message : "Unknown error"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            If you just set up Supabase, apply the migration in{" "}
            <code>supabase/migrations/001_initial_schema.sql</code> and refresh.
          </p>
        </CardContent>
      </Card>
    );
  }

  const stats = [
    {
      label: "Total expenses",
      value: money(data.stats.totalExpenses),
      icon: TrendingUp,
    },
    {
      label: "This month",
      value: money(data.stats.monthlySpend),
      icon: Receipt,
    },
    {
      label: "Groups",
      value: String(data.stats.groupsCount),
      icon: Users,
    },
    {
      label: "Friends",
      value: String(data.stats.friendsCount),
      icon: UserPlus,
    },
  ];

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            {data.stats.mostActiveGroup
              ? `Most active group: ${data.stats.mostActiveGroup}`
              : "Upload a receipt to get started."}
          </p>
        </div>
        <Button asChild className="w-full shrink-0 sm:w-auto">
          <Link href="/receipts/new">
            <Upload /> Quick upload
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="min-w-0"
          >
            <Card className="h-full">
              <CardContent className="flex items-start justify-between gap-2 p-3.5 sm:p-5">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground sm:text-sm">{stat.label}</p>
                  <p className="mt-1 truncate text-lg font-semibold tracking-tight sm:mt-2 sm:text-2xl">
                    {stat.value}
                  </p>
                </div>
                <div className="hidden rounded-xl bg-accent p-2.5 text-accent-foreground sm:block">
                  <stat.icon className="h-4 w-4" />
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid gap-4 sm:gap-6 xl:grid-cols-3">
        <Card className="min-w-0 xl:col-span-2">
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-base sm:text-lg">Monthly spending</CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              Last six months of your receipt totals
            </CardDescription>
          </CardHeader>
          <CardContent className="h-56 px-2 pb-4 sm:h-72 sm:px-6 sm:pb-6">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.monthlyChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="spend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={11} />
                <YAxis
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  width={40}
                  tickFormatter={(v) =>
                    new Intl.NumberFormat("en-PH", {
                      notation: "compact",
                      maximumFractionDigits: 1,
                    }).format(Number(v))
                  }
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                  }}
                  formatter={(value) => money(Number(value))}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="var(--primary)"
                  fill="url(#spend)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-base sm:text-lg">Recent activity</CardTitle>
            <CardDescription className="text-xs sm:text-sm">Your latest actions</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            {data.activities.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              <ul className="space-y-4">
                {data.activities.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-3 text-sm">
                    <span className="min-w-0 font-medium capitalize">
                      {a.action.replaceAll("_", " ")}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader className="flex flex-col gap-3 space-y-0 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <CardTitle className="text-base sm:text-lg">Recent receipts</CardTitle>
              <CardDescription className="text-xs sm:text-sm">OCR and edits land here</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild className="self-start sm:self-auto">
              <Link href="/receipts">
                View all <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            {data.recentReceipts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center sm:px-6 sm:py-10">
                <p className="text-sm text-muted-foreground">No receipts yet.</p>
                <Button className="mt-4 w-full sm:w-auto" asChild>
                  <Link href="/receipts/new">Upload your first receipt</Link>
                </Button>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {data.recentReceipts.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-3 py-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.merchant ?? "Untitled receipt"}</p>
                      <p className="text-xs capitalize text-muted-foreground">
                        {r.status.replaceAll("_", " ")}
                      </p>
                    </div>
                    <p className="shrink-0 font-medium">
                      {money(Number(r.total), r.currency)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader className="flex flex-col gap-3 space-y-0 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <CardTitle className="text-base sm:text-lg">Groups</CardTitle>
              <CardDescription className="text-xs sm:text-sm">Shared spaces for splits</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild className="self-start sm:self-auto">
              <Link href="/groups">
                Manage <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            {data.groups.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center sm:px-6 sm:py-10">
                <p className="text-sm text-muted-foreground">
                  Create a group for dinners, travel, or roommates.
                </p>
                <Button className="mt-4 w-full sm:w-auto" variant="outline" asChild>
                  <Link href="/groups">Create group</Link>
                </Button>
              </div>
            ) : (
              <ul className="space-y-3">
                {data.groups.map((g) => (
                  <li
                    key={g.id}
                    className="flex items-center gap-3 rounded-xl bg-muted/40 px-3 py-2.5"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
                      {g.name[0]}
                    </div>
                    <span className="truncate text-sm font-medium">{g.name}</span>
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
