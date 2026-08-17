import { d, moneyNumber } from "@/lib/money";

export type SplitMethod = "equal" | "percentage" | "quantity" | "custom" | "weighted";

/** Who the item total is divided among (owner-configured). */
export type ItemSplitMode = "among_claimers" | "among_group" | "among_n";

export type AssignmentInput = {
  memberId: string;
  splitMethod: SplitMethod;
  /** 0–100 for percentage */
  sharePercentage?: number | null;
  /** portion of item quantity */
  shareQuantity?: number | null;
  /** fixed PHP amount for custom */
  shareAmount?: number | null;
  /** relative weight for weighted (defaults to 1) */
  weight?: number | null;
};

export type ItemSplitInput = {
  itemId: string;
  itemName: string;
  itemTotal: number;
  itemQuantity: number;
  assignments: AssignmentInput[];
  /** Default among_claimers */
  splitMode?: ItemSplitMode | null;
  /** Used when splitMode === among_n */
  splitN?: number | null;
};

export type MemberShare = {
  memberId: string;
  itemsSubtotal: number;
  /** Pro-rata share of tax/tip/service/discount based on items share */
  adjustments: number;
  total: number;
  lines: Array<{
    itemId: string;
    itemName: string;
    amount: number;
    method: SplitMethod;
  }>;
};

export type SplitSummary = {
  members: MemberShare[];
  unassignedTotal: number;
  assignedTotal: number;
  grandTotal: number;
  remaining: number;
};

function allocateEqual(total: number, memberIds: string[]): Map<string, number> {
  const map = new Map<string, number>();
  if (memberIds.length === 0) return map;
  const each = d(total).div(memberIds.length);
  let allocated = d(0);
  memberIds.forEach((id, i) => {
    if (i === memberIds.length - 1) {
      map.set(id, moneyNumber(d(total).minus(allocated)));
    } else {
      const amt = moneyNumber(each);
      map.set(id, amt);
      allocated = allocated.plus(amt);
    }
  });
  return map;
}

export type AdjustmentLine = {
  name: string;
  amount: number;
};

/** Per-member share of tax, tip, discount, and service charge for display in item lists. */
export function memberAdjustmentLines(
  memberId: string,
  itemsSubtotal: number,
  itemsAssignedTotal: number,
  adjustments: Adjustments,
  equalServiceChargeMemberIds: string[] = []
): AdjustmentLine[] {
  const lines: AdjustmentLine[] = [];
  const ratio =
    itemsAssignedTotal > 0 ? d(itemsSubtotal).div(itemsAssignedTotal) : d(0);

  const tax = moneyNumber(d(adjustments.tax).mul(ratio));
  const tip = moneyNumber(d(adjustments.tip).mul(ratio));
  const discount = moneyNumber(d(adjustments.discount).mul(ratio));

  if (tax > 0) lines.push({ name: "Tax", amount: tax });
  if (tip > 0) lines.push({ name: "Tip", amount: tip });
  if (discount > 0) lines.push({ name: "Discount", amount: -discount });

  const serviceCharge = Number(adjustments.serviceCharge);
  if (serviceCharge > 0) {
    const serviceIds = equalServiceChargeMemberIds.filter(Boolean);
    if (serviceIds.length > 0 && serviceIds.includes(memberId)) {
      const share = allocateEqual(serviceCharge, serviceIds).get(memberId) ?? 0;
      if (share > 0) lines.push({ name: "Service charge", amount: share });
    } else if (serviceIds.length === 0 && itemsAssignedTotal > 0) {
      const share = moneyNumber(d(serviceCharge).mul(ratio));
      if (share > 0) lines.push({ name: "Service charge", amount: share });
    }
  }

  return lines;
}

function allocatePercentage(
  total: number,
  assignments: AssignmentInput[]
): Map<string, number> {
  const map = new Map<string, number>();
  let allocated = d(0);
  assignments.forEach((a, i) => {
    const pct = d(a.sharePercentage ?? 0).div(100);
    if (i === assignments.length - 1) {
      map.set(a.memberId, moneyNumber(d(total).minus(allocated)));
    } else {
      const amt = moneyNumber(d(total).mul(pct));
      map.set(a.memberId, amt);
      allocated = allocated.plus(amt);
    }
  });
  return map;
}

function allocateQuantity(
  itemTotal: number,
  itemQuantity: number,
  assignments: AssignmentInput[]
): Map<string, number> {
  const map = new Map<string, number>();
  const qty = d(itemQuantity || 1);
  assignments.forEach((a) => {
    const shareQty = d(a.shareQuantity ?? 0);
    const amt = moneyNumber(d(itemTotal).mul(shareQty).div(qty));
    map.set(a.memberId, (map.get(a.memberId) ?? 0) + amt);
  });
  return map;
}

function allocateCustom(assignments: AssignmentInput[]): Map<string, number> {
  const map = new Map<string, number>();
  assignments.forEach((a) => {
    map.set(a.memberId, moneyNumber(a.shareAmount ?? 0));
  });
  return map;
}

function allocateWeighted(
  total: number,
  assignments: AssignmentInput[]
): Map<string, number> {
  const map = new Map<string, number>();
  const weightSum = assignments.reduce((s, a) => s.plus(a.weight ?? 1), d(0));
  if (weightSum.lte(0)) return map;
  let allocated = d(0);
  assignments.forEach((a, i) => {
    const w = d(a.weight ?? 1);
    if (i === assignments.length - 1) {
      map.set(a.memberId, moneyNumber(d(total).minus(allocated)));
    } else {
      const amt = moneyNumber(d(total).mul(w).div(weightSum));
      map.set(a.memberId, amt);
      allocated = allocated.plus(amt);
    }
  });
  return map;
}

/** Split a single item across assignees. */
export function splitItemAmount(
  itemTotal: number,
  itemQuantity: number,
  assignments: AssignmentInput[],
  options?: {
    splitMode?: ItemSplitMode | null;
    splitN?: number | null;
    groupMemberIds?: string[];
  }
): Map<string, number> {
  const mode = options?.splitMode ?? "among_claimers";
  const groupIds = options?.groupMemberIds ?? [];

  // Whole-group: charge everyone equally, ignore claim list for the pool
  if (mode === "among_group") {
    const pool = resolveItemSplitPool(
      mode,
      assignments.map((a) => a.memberId),
      groupIds,
      options?.splitN
    );
    if (pool.memberIds.length === 0) return new Map();
    return allocateEqual(itemTotal, pool.memberIds);
  }

  // Fixed N-way split: each share is total/N; claimers can take multiple shares
  if (mode === "among_n") {
    const n = Math.max(1, Math.floor(Number(options?.splitN) || 1));
    if (assignments.length === 0) return new Map();
    const map = new Map<string, number>();
    for (const a of assignments) {
      const shares = Math.max(0, Number(a.shareQuantity ?? 1));
      const amt = moneyNumber(d(itemTotal).mul(shares).div(n));
      map.set(a.memberId, (map.get(a.memberId) ?? 0) + amt);
    }
    return map;
  }

  if (mode === "among_claimers") {
    if (assignments.length === 0) return new Map();
    const qtyOnReceipt = Math.max(0.001, itemQuantity || 1);
    if (qtyOnReceipt > 1) {
      return allocateQuantity(itemTotal, itemQuantity, assignments);
    }
    return allocateEqual(
      itemTotal,
      assignments.map((a) => a.memberId)
    );
  }

  if (assignments.length === 0) return new Map();

  const method = assignments[0]?.splitMethod ?? "equal";
  // If mixed methods, treat each assignment independently for custom/quantity;
  // for equal/percentage/weighted require same method on all.
  const allSame = assignments.every((a) => a.splitMethod === method);

  if (!allSame) {
    // Hybrid: sum custom amounts + equal-split remainder among equal assignees
    const map = new Map<string, number>();
    let claimed = d(0);
    const equalIds: string[] = [];
    for (const a of assignments) {
      if (a.splitMethod === "custom") {
        const amt = moneyNumber(a.shareAmount ?? 0);
        map.set(a.memberId, (map.get(a.memberId) ?? 0) + amt);
        claimed = claimed.plus(amt);
      } else if (a.splitMethod === "quantity") {
        const qty = d(itemQuantity || 1);
        const amt = moneyNumber(d(itemTotal).mul(a.shareQuantity ?? 0).div(qty));
        map.set(a.memberId, (map.get(a.memberId) ?? 0) + amt);
        claimed = claimed.plus(amt);
      } else if (a.splitMethod === "percentage") {
        const amt = moneyNumber(d(itemTotal).mul(d(a.sharePercentage ?? 0).div(100)));
        map.set(a.memberId, (map.get(a.memberId) ?? 0) + amt);
        claimed = claimed.plus(amt);
      } else {
        equalIds.push(a.memberId);
      }
    }
    const remainder = moneyNumber(d(itemTotal).minus(claimed));
    if (equalIds.length > 0 && remainder > 0) {
      const eq = allocateEqual(remainder, equalIds);
      eq.forEach((v, k) => map.set(k, (map.get(k) ?? 0) + v));
    }
    return map;
  }

  switch (method) {
    case "percentage":
      return allocatePercentage(itemTotal, assignments);
    case "quantity":
      return allocateQuantity(itemTotal, itemQuantity, assignments);
    case "custom":
      return allocateCustom(assignments);
    case "weighted":
      return allocateWeighted(itemTotal, assignments);
    case "equal":
    default:
      return allocateEqual(
        itemTotal,
        assignments.map((a) => a.memberId)
      );
  }
}

export type Adjustments = {
  tax: number;
  discount: number;
  serviceCharge: number;
  tip: number;
};

export type SplitOptions = {
  grandTotal?: number;
  /**
   * When set (typically every group member), service charge is split equally
   * across these people — even if they claimed no items.
   */
  equalServiceChargeMemberIds?: string[];
  /** All group member IDs — used for items with split_mode = among_group */
  groupMemberIds?: string[];
};

/**
 * Resolve who pays and the divisor for an item's equal split.
 * - among_claimers: ÷ number of people who claimed
 * - among_group: ÷ every group member (auto-includes all)
 * - among_n: ÷ owner-set N; each claimed share pays total/N (one person can take 2+ shares)
 */
export function resolveItemSplitPool(
  mode: ItemSplitMode | null | undefined,
  claimedMemberIds: string[],
  groupMemberIds: string[],
  splitN: number | null | undefined
): { memberIds: string[]; divisor: number } {
  const claimed = [...new Set(claimedMemberIds.filter(Boolean))];
  const group = [...new Set(groupMemberIds.filter(Boolean))];

  if (mode === "among_group") {
    const ids = group.length ? group : claimed;
    return { memberIds: ids, divisor: Math.max(ids.length, 1) };
  }

  if (mode === "among_n") {
    const n = Math.max(1, Math.floor(Number(splitN) || claimed.length || 1));
    return { memberIds: claimed, divisor: n };
  }

  // among_claimers (default)
  return { memberIds: claimed, divisor: Math.max(claimed.length, 1) };
}

/**
 * How many shares/slots exist for claiming.
 * null = unlimited (shared — stays visible while units remain).
 * among_n: N shares (one person may take several).
 * Default / unset = 1 (one person — hide after claimed).
 */
export function itemClaimSlots(
  mode: ItemSplitMode | null | undefined,
  splitN?: number | null
): number | null {
  if (mode === "among_group") return null;
  if (mode === "among_claimers") return null; // shared on purpose
  if (mode === "among_n") return Math.max(1, Math.floor(Number(splitN) || 1));
  // Unset / legacy → one person only (hide when claimed)
  return 1;
}

/** True when this member should not see the item (taken by others). */
export function isItemHiddenFromMember(
  mode: ItemSplitMode | null | undefined,
  splitN: number | null | undefined,
  claimerIds: string[],
  myMemberId: string | null | undefined,
  opts?: { remainingQuantity?: number | null; itemQuantity?: number | null }
): boolean {
  if (myMemberId && claimerIds.includes(myMemberId)) return false;

  const remaining = opts?.remainingQuantity;
  if (remaining != null && remaining <= 0) return true;

  const slots = itemClaimSlots(mode, splitN);
  if (slots == null) {
    // Shared / quantity pool — hide only when nothing left
    return remaining != null ? remaining <= 0 : false;
  }

  // Multi-way among_n: remainingQuantity is remaining shares
  if (mode === "among_n" && slots > 1) {
    return remaining != null ? remaining <= 0 : false;
  }

  return claimerIds.length >= slots;
}

export function itemSplitModeLabel(
  mode: ItemSplitMode | null | undefined,
  splitN?: number | null,
  groupSize?: number
): string {
  if (mode === "among_group") {
    return groupSize
      ? `Split equally among all ${groupSize} members`
      : "Split equally among the whole group";
  }
  if (mode === "among_claimers") {
    return "Split among whoever claims";
  }
  if (mode === "among_n") {
    const n = Number(splitN) || 1;
    if (n <= 1) return "One person only";
    return `Split ${n} ways`;
  }
  return "One person only";
}

/** Per-person share for group or N-way splits; null when not applicable. */
export function itemSplitPerPersonAmount(
  itemTotal: number,
  mode: ItemSplitMode | null | undefined,
  splitN?: number | null,
  groupSize?: number
): number | null {
  if (mode === "among_group") {
    const n = Math.max(1, Math.floor(Number(groupSize) || 0));
    if (n <= 0) return null;
    return moneyNumber(itemTotal / n);
  }
  if (mode === "among_n") {
    const n = Math.max(1, Math.floor(Number(splitN) || 1));
    if (n <= 1) return null;
    return moneyNumber(itemTotal / n);
  }
  return null;
}

/** Share amount to show while picking or after a claim (not the full line total). */
export function itemPickShareAmount(
  itemTotal: number,
  quantity: number,
  mode: ItemSplitMode | null | undefined,
  splitN: number | null | undefined,
  groupSize: number,
  claimedQty: number
): number {
  const total = Number(itemTotal) || 0;
  const perPerson = itemSplitPerPersonAmount(total, mode, splitN, groupSize);
  if (perPerson != null) {
    return moneyNumber(perPerson * Math.max(1, claimedQty));
  }
  const qtyOnReceipt = Math.max(0.001, Number(quantity) || 1);
  const q = Math.max(1, claimedQty);
  if (mode === "among_claimers" && qtyOnReceipt > 1) {
    return moneyNumber((total / qtyOnReceipt) * q);
  }
  return moneyNumber(total);
}

export function itemPickShareLabel(
  mode: ItemSplitMode | null | undefined,
  splitN: number | null | undefined,
  quantity: number,
  selected: boolean
): string {
  if (selected) return "You pay";
  const resolved = mode ?? "among_n";
  const n = Math.max(1, Math.floor(Number(splitN) || 1));
  const qty = Math.max(0.001, Number(quantity) || 1);
  if (resolved === "among_group") return "Your share";
  if (resolved === "among_n" && n > 1) return "Per share";
  if (resolved === "among_claimers" && qty > 1) return "Per unit";
  return "You pay";
}

/** Price to show on receipt/member lists (share, not full line total when split). */
export function itemListDisplayShareAmount(
  itemTotal: number,
  quantity: number,
  mode: ItemSplitMode | null | undefined,
  splitN: number | null | undefined,
  groupSize: number,
  claimerCount: number
): number {
  const total = Number(itemTotal) || 0;
  const perPerson = itemSplitPerPersonAmount(total, mode, splitN, groupSize);
  if (perPerson != null) return perPerson;

  const qty = Math.max(0.001, Number(quantity) || 1);
  const resolved = mode ?? "among_n";
  if (resolved === "among_claimers") {
    if (qty > 1) return moneyNumber(total / qty);
    if (claimerCount > 0) return moneyNumber(total / claimerCount);
  }
  const n = Math.max(1, Math.floor(Number(splitN) || 1));
  if (resolved === "among_n" && n > 1) return moneyNumber(total / n);
  return moneyNumber(total);
}

function ensureMember(
  memberMap: Map<string, MemberShare>,
  memberId: string
): MemberShare {
  const existing = memberMap.get(memberId);
  if (existing) return existing;
  const created: MemberShare = {
    memberId,
    itemsSubtotal: 0,
    adjustments: 0,
    total: 0,
    lines: [],
  };
  memberMap.set(memberId, created);
  return created;
}

/**
 * Build per-member payment summary from item assignments.
 * Tax / tip / discount are allocated pro-rata by each member's items share.
 * Service charge is split equally among `equalServiceChargeMemberIds` (everyone
 * in the group) when provided; otherwise falls back to pro-rata.
 */
export function computeMemberSplits(
  items: ItemSplitInput[],
  adjustments: Adjustments,
  options?: SplitOptions
): SplitSummary {
  const memberMap = new Map<string, MemberShare>();

  let assignedTotal = d(0);
  let itemsGrand = d(0);

  for (const item of items) {
    itemsGrand = itemsGrand.plus(item.itemTotal);
    const shares = splitItemAmount(
      item.itemTotal,
      item.itemQuantity,
      item.assignments,
      {
        splitMode: item.splitMode,
        splitN: item.splitN,
        groupMemberIds: options?.groupMemberIds,
      }
    );
    let itemAssigned = d(0);
    shares.forEach((amount, memberId) => {
      itemAssigned = itemAssigned.plus(amount);
      const existing = ensureMember(memberMap, memberId);
      existing.itemsSubtotal = moneyNumber(d(existing.itemsSubtotal).plus(amount));
      existing.lines.push({
        itemId: item.itemId,
        itemName: item.itemName,
        amount,
        method:
          item.assignments.find((a) => a.memberId === memberId)?.splitMethod ??
          "equal",
      });
    });
    assignedTotal = assignedTotal.plus(itemAssigned);
  }

  const serviceIds = (options?.equalServiceChargeMemberIds ?? []).filter(Boolean);
  for (const id of serviceIds) {
    ensureMember(memberMap, id);
  }

  const unassignedTotal = moneyNumber(itemsGrand.minus(assignedTotal));
  const otherAdj = d(adjustments.tax)
    .plus(adjustments.tip)
    .minus(adjustments.discount);
  const serviceCharge = d(adjustments.serviceCharge);

  const itemsAssignedNum = moneyNumber(assignedTotal);

  // Tax / tip / discount — pro-rata by items claimed
  memberMap.forEach((m) => {
    const ratio =
      itemsAssignedNum > 0 ? d(m.itemsSubtotal).div(itemsAssignedNum) : d(0);
    m.adjustments = moneyNumber(otherAdj.mul(ratio));
  });

  // Service charge — equal among everyone in the group
  if (serviceCharge.gt(0)) {
    if (serviceIds.length > 0) {
      const eq = allocateEqual(moneyNumber(serviceCharge), serviceIds);
      eq.forEach((amt, id) => {
        const m = ensureMember(memberMap, id);
        m.adjustments = moneyNumber(d(m.adjustments).plus(amt));
      });
    } else {
      // No group roster yet — fall back to pro-rata among assignees
      memberMap.forEach((m) => {
        const ratio =
          itemsAssignedNum > 0 ? d(m.itemsSubtotal).div(itemsAssignedNum) : d(0);
        m.adjustments = moneyNumber(d(m.adjustments).plus(serviceCharge.mul(ratio)));
      });
    }
  }

  memberMap.forEach((m) => {
    m.total = moneyNumber(d(m.itemsSubtotal).plus(m.adjustments));
  });

  const members = Array.from(memberMap.values()).sort((a, b) =>
    a.memberId.localeCompare(b.memberId)
  );

  const membersSum = members.reduce((s, m) => s.plus(m.total), d(0));
  const computedGrand = moneyNumber(itemsGrand.plus(otherAdj).plus(serviceCharge));
  const target =
    options?.grandTotal !== undefined
      ? moneyNumber(options.grandTotal)
      : computedGrand;

  return {
    members,
    unassignedTotal,
    assignedTotal: itemsAssignedNum,
    grandTotal: target,
    remaining: moneyNumber(
      d(target)
        .minus(membersSum)
        .minus(
          unassignedTotal > 0
            ? d(unassignedTotal).mul(
                d(target).div(itemsGrand.gt(0) ? itemsGrand : 1)
              )
            : 0
        )
    ),
  };
}

/** Simplify remaining: grandTotal - sum(member totals) - unassigned's pro-rata of tax/tip/discount */
export function computeSplitBalances(
  items: ItemSplitInput[],
  adjustments: Adjustments,
  options?: SplitOptions
): SplitSummary {
  const summary = computeMemberSplits(items, adjustments, options);
  const otherAdj = d(adjustments.tax)
    .plus(adjustments.tip)
    .minus(adjustments.discount);
  const serviceCharge = d(adjustments.serviceCharge);
  const itemsGrand = items.reduce((s, i) => s.plus(i.itemTotal), d(0));
  const fullTotal = moneyNumber(itemsGrand.plus(otherAdj).plus(serviceCharge));
  const paidByMembers = summary.members.reduce((s, m) => s.plus(m.total), d(0));

  // Unassigned items get pro-rata tax/tip/discount only — service already
  // went equally to every group member.
  const unassignedAdj =
    itemsGrand.gt(0) && summary.unassignedTotal > 0
      ? moneyNumber(otherAdj.mul(d(summary.unassignedTotal).div(itemsGrand)))
      : 0;
  const unassignedWithAdj = moneyNumber(d(summary.unassignedTotal).plus(unassignedAdj));

  return {
    ...summary,
    grandTotal: fullTotal,
    remaining: moneyNumber(d(fullTotal).minus(paidByMembers).minus(unassignedWithAdj)),
    unassignedTotal: unassignedWithAdj,
  };
}

/** Given who paid the bill, how much each other member owes that payer. */
export function computeOwesToPayer(
  summary: SplitSummary,
  paidByMemberId: string | null | undefined
): Array<{ fromMemberId: string; toMemberId: string; amount: number }> {
  if (!paidByMemberId) return [];
  return summary.members
    .filter((m) => m.memberId !== paidByMemberId && m.total > 0)
    .map((m) => ({
      fromMemberId: m.memberId,
      toMemberId: paidByMemberId,
      amount: m.total,
    }));
}
