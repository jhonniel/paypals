import { useQuery } from "@tanstack/react-query";

export type OwedToYouRow = {
  memberId: string;
  userId: string | null;
  name: string;
  amount: number;
  currency: string;
  receiptCount: number;
  receiptIds: string[];
};

export type DashboardData = {
  stats: {
    totalExpenses: number;
    monthlySpend: number;
    groupsCount: number;
    friendsCount: number;
    unreadNotifications: number;
    mostActiveGroup: string | null;
    totalOwedToYou: number;
  };
  recentReceipts: Array<{
    id: string;
    merchant: string | null;
    total: number;
    currency: string;
    status: string;
    created_at: string;
    group_id: string | null;
  }>;
  groups: Array<{ id: string; name: string; photo_url: string | null }>;
  activities: Array<{
    id: string;
    action: string;
    metadata: unknown;
    created_at: string;
    group_id: string | null;
    receipt_id: string | null;
  }>;
  monthlyChart: Array<{ label: string; total: number }>;
  owedToYou: OwedToYouRow[];
};

async function fetchDashboard(): Promise<DashboardData> {
  const res = await fetch("/api/dashboard");
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message ?? "Failed to load dashboard");
  }
  return json.data;
}

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: fetchDashboard,
  });
}
