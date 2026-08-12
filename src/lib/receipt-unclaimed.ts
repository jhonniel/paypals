export type ReceiptItemClaimInfo = {
  id: string;
  name: string;
  quantity: number;
  total_price: number;
  split_mode?: string | null;
  split_n?: number | null;
  remaining_quantity?: number;
  claimed_quantity?: number;
  claims?: Array<{ member_id: string; name: string; quantity: number }>;
};

/** Claim pool size: N-way shares vs receipt line units. */
export function itemClaimPoolSize(item: ReceiptItemClaimInfo): number {
  const mode = item.split_mode ?? "among_n";
  const splitN = Math.max(1, Math.floor(Number(item.split_n) || 1));
  const qtyOnReceipt = Math.max(0, Number(item.quantity) || 0);
  if (mode === "among_n" && splitN > 1) return splitN;
  return Math.max(qtyOnReceipt, 1);
}

export function itemRemainingQuantity(item: ReceiptItemClaimInfo): number {
  if (item.split_mode === "among_group") return 0;
  if (item.remaining_quantity != null) {
    return Math.max(0, item.remaining_quantity);
  }
  const poolSize = itemClaimPoolSize(item);
  const claimed =
    item.claimed_quantity ??
    (item.claims ?? []).reduce(
      (sum, c) => sum + Math.max(0, Number(c.quantity) || 0),
      0
    );
  return Math.max(0, poolSize - claimed);
}

export function unclaimedItemValue(item: ReceiptItemClaimInfo): number {
  const remaining = itemRemainingQuantity(item);
  if (remaining <= 0) return 0;
  const poolSize = itemClaimPoolSize(item);
  const lineTotal = Number(item.total_price) || 0;
  return lineTotal * (remaining / poolSize);
}

export function formatRemainingLabel(item: ReceiptItemClaimInfo): string | null {
  const remaining = itemRemainingQuantity(item);
  if (remaining <= 0) return null;

  const poolSize = itemClaimPoolSize(item);
  const mode = item.split_mode ?? "among_n";
  const splitN = Math.max(1, Math.floor(Number(item.split_n) || 1));
  const multiWay = mode === "among_n" && splitN > 1;

  if (multiWay) {
    return `${remaining} of ${poolSize} share${poolSize === 1 ? "" : "s"} left`;
  }
  if (poolSize > 1) {
    return `${remaining} of ${poolSize} left`;
  }
  return "Not claimed yet";
}

export type UnclaimedItemSummary = {
  id: string;
  name: string;
  remaining: number;
  poolSize: number;
  value: number;
  label: string;
};

export function getReceiptUnclaimedItems(items: ReceiptItemClaimInfo[]): {
  items: UnclaimedItemSummary[];
  count: number;
  totalValue: number;
} {
  const unclaimed: UnclaimedItemSummary[] = [];
  let totalValue = 0;

  for (const item of items) {
    if (item.split_mode === "among_group") continue;
    const remaining = itemRemainingQuantity(item);
    if (remaining <= 0) continue;

    const value = unclaimedItemValue(item);
    const label = formatRemainingLabel(item) ?? "Unclaimed";
    unclaimed.push({
      id: item.id,
      name: item.name,
      remaining,
      poolSize: itemClaimPoolSize(item),
      value,
      label,
    });
    totalValue += value;
  }

  return { items: unclaimed, count: unclaimed.length, totalValue };
}

export function ownerItemClaimLine(item: ReceiptItemClaimInfo): {
  line: string;
  unclaimed: boolean;
} {
  const isGroupSplit = item.split_mode === "among_group";
  const remaining = itemRemainingQuantity(item);
  const claims = item.claims ?? [];
  const claimLabel =
    claims.length > 0
      ? claims
          .map((c) => (c.quantity > 1 ? `${c.name} ×${c.quantity}` : c.name))
          .join(", ")
      : "";

  if (isGroupSplit) {
    return { line: "Split with whole group", unclaimed: false };
  }
  if (remaining <= 0) {
    return {
      line: claimLabel ? `Claimed by ${claimLabel}` : "Fully claimed",
      unclaimed: false,
    };
  }

  const remainingLabel = formatRemainingLabel(item) ?? "Unclaimed";
  if (claimLabel) {
    return {
      line: `${remainingLabel} · also claimed by ${claimLabel}`,
      unclaimed: true,
    };
  }
  return { line: remainingLabel, unclaimed: true };
}
