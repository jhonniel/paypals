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

export type ConfirmedPaymentRow = {
  id: string;
  groupId: string;
  groupName: string;
  fromName: string;
  fromMemberId: string;
  toName: string | null;
  amount: number;
  currency: string;
  paidAt: string | null;
  ocrDate: string | null;
  direction: "received" | "sent";
};

export type PalOwedToYouRow = {
  debtorId: string;
  name: string;
  amount: number;
  currency: string;
  debtCount: number;
};

export type PalOweToOthersRow = {
  creditorId: string;
  name: string;
  amount: number;
  currency: string;
  debtCount: number;
};

export type UnclaimedReceiptRow = {
  receiptId: string;
  merchant: string | null;
  groupId: string;
  groupName: string;
  currency: string;
  items: Array<{
    id: string;
    name: string;
    label: string;
    value: number;
  }>;
  itemCount: number;
  totalValue: number;
};

export type DashboardData = {
  stats: {
    userSpent: number;
    userSpentThisMonth: number;
    overallSpent: number;
    userOwes: number;
    monthlySpend: number;
    groupsCount: number;
    friendsCount: number;
    unreadNotifications: number;
    mostActiveGroup: string | null;
    totalOwedToYou: number;
    palDebtsOpenTotal: number;
    palDebtsOweTotal: number;
    balanceToCollect: number;
    unclaimedItemCount: number;
    unclaimedItemValue: number;
    collectPendingCount: number;
    totalPaymentsReceived: number;
    totalPaymentsSent: number;
    paymentsReceivedThisMonth: number;
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
  monthlyChart: Array<{ label: string; total: number; payments?: number }>;
  owedToYou: OwedToYouRow[];
  palOwedToYou: PalOwedToYouRow[];
  palOweToOthers: PalOweToOthersRow[];
  unclaimedReceipts: UnclaimedReceiptRow[];
  confirmedPayments: ConfirmedPaymentRow[];
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
    staleTime: 90_000,
  });
}
