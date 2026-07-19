import type { SupabaseClient } from "@supabase/supabase-js";
import { moneyNumber } from "@/lib/money";

export type ConfirmedPaymentRow = {
  id: string;
  groupId: string;
  groupName: string;
  /** Who paid (debtor). */
  fromName: string;
  fromMemberId: string;
  /** Who received (bill payer). */
  toName: string | null;
  amount: number;
  currency: string;
  paidAt: string | null;
  ocrDate: string | null;
  /** Direction relative to the current user. */
  direction: "received" | "sent";
};

function memberLabel(m: {
  guest_name?: string | null;
  profiles?:
    | { full_name: string | null; username: string | null }
    | { full_name: string | null; username: string | null }[]
    | null;
}): string {
  const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
  return p?.full_name || p?.username || m.guest_name || "Member";
}

/**
 * Confirmed (OCR-validated) group payment proofs for the current user —
 * both money they sent and money they received.
 */
export async function computeConfirmedPayments(
  supabase: SupabaseClient,
  userId: string
): Promise<{
  rows: ConfirmedPaymentRow[];
  totalReceived: number;
  totalSent: number;
  /** from_member_id set that has paid status (for owed subtraction). */
  paidFromMemberIds: Set<string>;
}> {
  const { data: myMemberships } = await supabase
    .from("group_members")
    .select("id, group_id")
    .eq("user_id", userId);

  const myMemberIds = (myMemberships ?? []).map((m) => m.id);
  if (!myMemberIds.length) {
    return {
      rows: [],
      totalReceived: 0,
      totalSent: 0,
      paidFromMemberIds: new Set(),
    };
  }

  const { data: proofs, error } = await supabase
    .from("group_payment_proofs")
    .select(
      "id, group_id, from_member_id, to_member_id, expected_amount, ocr_amount, currency, validated_at, ocr_date, status"
    )
    .eq("status", "paid")
    .or(
      `from_member_id.in.(${myMemberIds.join(",")}),to_member_id.in.(${myMemberIds.join(",")})`
    )
    .order("validated_at", { ascending: false })
    .limit(40);

  if (error || !proofs?.length) {
    // Table may not exist yet — treat as empty
    return {
      rows: [],
      totalReceived: 0,
      totalSent: 0,
      paidFromMemberIds: new Set(),
    };
  }

  const memberIds = [
    ...new Set(
      proofs.flatMap((p) =>
        [p.from_member_id, p.to_member_id].filter(Boolean) as string[]
      )
    ),
  ];
  const groupIds = [...new Set(proofs.map((p) => p.group_id))];

  const [{ data: members }, { data: groups }] = await Promise.all([
    supabase
      .from("group_members")
      .select(
        "id, guest_name, profiles:user_id(full_name, username)"
      )
      .in("id", memberIds),
    supabase.from("groups").select("id, name").in("id", groupIds),
  ]);

  const memberById = new Map((members ?? []).map((m) => [m.id, m]));
  const groupById = new Map((groups ?? []).map((g) => [g.id, g]));

  const mySet = new Set(myMemberIds);
  const paidFromMemberIds = new Set<string>();
  const rows: ConfirmedPaymentRow[] = [];
  let totalReceived = 0;
  let totalSent = 0;

  for (const p of proofs) {
    const amount = moneyNumber(p.ocr_amount ?? p.expected_amount);
    const currency = p.currency || "PHP";
    const from = memberById.get(p.from_member_id);
    const to = p.to_member_id ? memberById.get(p.to_member_id) : null;
    const group = groupById.get(p.group_id);
    const iReceived = p.to_member_id ? mySet.has(p.to_member_id) : false;
    const iSent = mySet.has(p.from_member_id);

    if (iSent) {
      totalSent = moneyNumber(totalSent + amount);
      paidFromMemberIds.add(p.from_member_id);
    }
    if (iReceived) {
      totalReceived = moneyNumber(totalReceived + amount);
      // Someone paid me — their from_member is settled for owed calc
      paidFromMemberIds.add(p.from_member_id);
    }

    // Prefer showing rows where user is involved; if both, show as received first
    const direction: "received" | "sent" = iReceived ? "received" : "sent";

    rows.push({
      id: p.id,
      groupId: p.group_id,
      groupName: group?.name ?? "Group",
      fromName: from ? memberLabel(from) : "Member",
      fromMemberId: p.from_member_id,
      toName: to ? memberLabel(to) : null,
      amount,
      currency,
      paidAt: p.validated_at,
      ocrDate: p.ocr_date,
      direction,
    });
  }

  return { rows, totalReceived, totalSent, paidFromMemberIds };
}
