import type { SupabaseClient } from "@supabase/supabase-js";
import { moneyNumber } from "@/lib/money";
import {
  computeSplitBalances,
  type AssignmentInput,
  type ItemSplitInput,
  type ItemSplitMode,
} from "@/lib/splits";

/** Compute what a group member currently owes across all group receipts. */
export async function getMemberGroupPayTotal(
  supabase: SupabaseClient,
  groupId: string,
  memberId: string
): Promise<{ total: number; currency: string } | null> {
  const { data: members } = await supabase
    .from("group_members")
    .select("id")
    .eq("group_id", groupId);
  const memberIds = (members ?? []).map((m) => m.id);
  if (!memberIds.includes(memberId)) return null;

  const { data: receipts } = await supabase
    .from("receipts")
    .select(
      `id, currency, tax, discount, service_charge, tip,
       receipt_items(id, name, quantity, total_price, sort_order, split_mode, split_n)`
    )
    .eq("group_id", groupId)
    .limit(50);

  if (!receipts?.length) return { total: 0, currency: "PHP" };

  const itemIds = receipts.flatMap((r) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((r as any).receipt_items ?? []).map((i: { id: string }) => i.id)
  );

  const assignmentsByItem = new Map<
    string,
    Array<{
      member_id: string;
      split_method: AssignmentInput["splitMethod"];
      share_percentage: number | null;
      share_quantity: number | null;
      share_amount: number | null;
    }>
  >();

  if (itemIds.length) {
    const { data: assignments } = await supabase
      .from("receipt_item_assignments")
      .select(
        "receipt_item_id, member_id, split_method, share_percentage, share_quantity, share_amount"
      )
      .in("receipt_item_id", itemIds);
    for (const a of assignments ?? []) {
      const list = assignmentsByItem.get(a.receipt_item_id) ?? [];
      list.push({
        member_id: a.member_id,
        split_method: a.split_method,
        share_percentage: a.share_percentage,
        share_quantity: a.share_quantity,
        share_amount: a.share_amount,
      });
      assignmentsByItem.set(a.receipt_item_id, list);
    }
  }

  let total = 0;
  let currency = "PHP";

  for (const r of receipts) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = ((r as any).receipt_items ?? []) as Array<{
      id: string;
      name: string;
      quantity: number;
      total_price: number;
      split_mode: string | null;
      split_n: number | null;
    }>;

    const splitItems: ItemSplitInput[] = items.map((item) => {
      const asg = assignmentsByItem.get(item.id) ?? [];
      const assignmentInputs: AssignmentInput[] = asg.map((a) => ({
        memberId: a.member_id,
        splitMethod: a.split_method,
        sharePercentage: a.share_percentage,
        shareQuantity: a.share_quantity,
        shareAmount: a.share_amount,
      }));
      return {
        itemId: item.id,
        itemName: item.name,
        itemTotal: Number(item.total_price),
        itemQuantity: Number(item.quantity),
        splitMode: (item.split_mode as ItemSplitMode) ?? "among_n",
        splitN: item.split_n ?? null,
        assignments: assignmentInputs,
      };
    });

    const summary = computeSplitBalances(
      splitItems,
      {
        tax: Number(r.tax),
        discount: Number(r.discount),
        serviceCharge: Number(r.service_charge),
        tip: Number(r.tip),
      },
      {
        equalServiceChargeMemberIds: memberIds,
        groupMemberIds: memberIds,
      }
    );

    currency = (r.currency as string) || currency;
    const share = summary.members.find((m) => m.memberId === memberId);
    if (share) total = moneyNumber(total + share.total);
  }

  return { total, currency };
}
