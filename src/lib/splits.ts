import { d, moneyNumber } from "@/lib/money";

export type SplitMethod = "equal" | "percentage" | "quantity" | "custom" | "weighted";

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
  assignments: AssignmentInput[]
): Map<string, number> {
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

/**
 * Build per-member payment summary from item assignments.
 * Tax / tip / service / discount are allocated pro-rata by each member's items share.
 */
export function computeMemberSplits(
  items: ItemSplitInput[],
  adjustments: Adjustments,
  grandTotal?: number
): SplitSummary {
  const memberMap = new Map<string, MemberShare>();

  let assignedTotal = d(0);
  let itemsGrand = d(0);

  for (const item of items) {
    itemsGrand = itemsGrand.plus(item.itemTotal);
    const shares = splitItemAmount(
      item.itemTotal,
      item.itemQuantity,
      item.assignments
    );
    let itemAssigned = d(0);
    shares.forEach((amount, memberId) => {
      itemAssigned = itemAssigned.plus(amount);
      const existing = memberMap.get(memberId) ?? {
        memberId,
        itemsSubtotal: 0,
        adjustments: 0,
        total: 0,
        lines: [],
      };
      existing.itemsSubtotal = moneyNumber(d(existing.itemsSubtotal).plus(amount));
      existing.lines.push({
        itemId: item.itemId,
        itemName: item.itemName,
        amount,
        method: item.assignments.find((a) => a.memberId === memberId)?.splitMethod ?? "equal",
      });
      memberMap.set(memberId, existing);
    });
    assignedTotal = assignedTotal.plus(itemAssigned);
  }

  const unassignedTotal = moneyNumber(itemsGrand.minus(assignedTotal));
  const netAdj = d(adjustments.tax)
    .plus(adjustments.serviceCharge)
    .plus(adjustments.tip)
    .minus(adjustments.discount);

  const itemsAssignedNum = moneyNumber(assignedTotal);
  memberMap.forEach((m) => {
    const ratio =
      itemsAssignedNum > 0 ? d(m.itemsSubtotal).div(itemsAssignedNum) : d(0);
    m.adjustments = moneyNumber(netAdj.mul(ratio));
    m.total = moneyNumber(d(m.itemsSubtotal).plus(m.adjustments));
  });

  const members = Array.from(memberMap.values()).sort((a, b) =>
    a.memberId.localeCompare(b.memberId)
  );

  const membersSum = members.reduce((s, m) => s.plus(m.total), d(0));
  const computedGrand = moneyNumber(
    itemsGrand.plus(netAdj)
  );
  const target = grandTotal !== undefined ? moneyNumber(grandTotal) : computedGrand;

  return {
    members,
    unassignedTotal,
    assignedTotal: itemsAssignedNum,
    grandTotal: target,
    remaining: moneyNumber(d(target).minus(membersSum).minus(unassignedTotal > 0 ? d(unassignedTotal).mul(d(target).div(itemsGrand.gt(0) ? itemsGrand : 1)) : 0)),
  };
}

/** Simplify remaining: grandTotal - sum(member totals) - unassigned's pro-rata of full bill */
export function computeSplitBalances(
  items: ItemSplitInput[],
  adjustments: Adjustments
): SplitSummary {
  const summary = computeMemberSplits(items, adjustments);
  const netAdj = d(adjustments.tax)
    .plus(adjustments.serviceCharge)
    .plus(adjustments.tip)
    .minus(adjustments.discount);
  const itemsGrand = items.reduce((s, i) => s.plus(i.itemTotal), d(0));
  const fullTotal = moneyNumber(itemsGrand.plus(netAdj));
  const paidByMembers = summary.members.reduce((s, m) => s.plus(m.total), d(0));
  // Unassigned items also get pro-rata adjustments
  const unassignedAdj =
    itemsGrand.gt(0) && summary.unassignedTotal > 0
      ? moneyNumber(netAdj.mul(d(summary.unassignedTotal).div(itemsGrand)))
      : 0;
  const unassignedWithAdj = moneyNumber(d(summary.unassignedTotal).plus(unassignedAdj));

  return {
    ...summary,
    grandTotal: fullTotal,
    remaining: moneyNumber(d(fullTotal).minus(paidByMembers).minus(unassignedWithAdj)),
    unassignedTotal: unassignedWithAdj,
  };
}
