import { z } from "zod";
import { getAuthedClient } from "@/lib/supabase/auth";
import {
  ok,
  unauthorized,
  notFound,
  fail,
  fromZod,
  serverError,
} from "@/lib/api";
import { moneyNumber } from "@/lib/money";
import {
  normalizePaymentMethods,
  resolvePaymentQrUrl,
  toSharedPaymentMethods,
} from "@/lib/payment-methods";
import {
  computeSplitBalances,
  memberAdjustmentLines,
  type AssignmentInput,
  type ItemSplitInput,
  type ItemSplitMode,
} from "@/lib/splits";
import { normalizeSubItems } from "@/lib/receipt-sub-items";
import {
  fetchReceiptDiscountsByReceiptIds,
  normalizeDiscountRows,
} from "@/lib/receipt-discounts";
import { resolveReceiptPayerMemberId } from "@/lib/group-member-payments";
import { groupInviteUrlFromRequest } from "@/lib/signup-invite-url";
import {
  generateGroupInviteCode,
  GROUP_INVITE_CODE_LENGTH,
  isUniqueInviteCodeViolation,
} from "@/lib/group-invite-code";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;
    const { id } = await params;

    const { data: group, error } = await supabase
      .from("groups")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) return fail(error.message, 400);
    if (!group) return notFound("Group not found");

    let membersQuery = await supabase
      .from("group_members")
      .select(
        "id, role, user_id, guest_email, guest_name, invite_token, claimed_at, joined_at, profiles:user_id(id, full_name, username, avatar_url, email, payment_methods)"
      )
      .eq("group_id", id)
      .order("joined_at", { ascending: true });

    if (membersQuery.error && /payment_methods|column/i.test(membersQuery.error.message)) {
      // Fallback when payment_methods column is missing — widen type for reassignment
      membersQuery = (await supabase
        .from("group_members")
        .select(
          "id, role, user_id, guest_email, guest_name, invite_token, claimed_at, joined_at, profiles:user_id(id, full_name, username, avatar_url, email)"
        )
        .eq("group_id", id)
        .order("joined_at", { ascending: true })) as typeof membersQuery;
    }

    const { data: members, error: membersError } = membersQuery;
    if (membersError) return fail(membersError.message, 400);

    const my = (members ?? []).find((m) => m.user_id === user.id);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let receipts: any[] | null = null;
    let receiptsError: { message: string } | null = null;

    {
      const first = await supabase
        .from("receipts")
        .select(
          `id, merchant, total, currency, status, receipt_date, receipt_time,
           subtotal, tax, discount, service_charge, tip, notes, created_at, created_by,
           paid_by_member_id,
           receipt_items(id, name, quantity, unit_price, total_price, sort_order, split_mode, split_n, sub_items),
           receipt_images(id),
           profiles:created_by(full_name, username)`
        )
        .eq("group_id", id)
        .order("created_at", { ascending: false })
        .limit(50);
      receipts = first.data;
      receiptsError = first.error;
    }

    if (receiptsError && /sub_items|column/i.test(receiptsError.message)) {
      const withoutSubs = await supabase
        .from("receipts")
        .select(
          `id, merchant, total, currency, status, receipt_date, receipt_time,
           subtotal, tax, discount, service_charge, tip, notes, created_at, created_by,
           paid_by_member_id,
           receipt_items(id, name, quantity, unit_price, total_price, sort_order, split_mode, split_n),
           receipt_images(id),
           profiles:created_by(full_name, username)`
        )
        .eq("group_id", id)
        .order("created_at", { ascending: false })
        .limit(50);
      receipts = withoutSubs.data;
      receiptsError = withoutSubs.error;
    }

    if (receiptsError && /paid_by_member_id|column/i.test(receiptsError.message)) {
      const withoutPaidBy = await supabase
        .from("receipts")
        .select(
          `id, merchant, total, currency, status, receipt_date, receipt_time,
           subtotal, tax, discount, service_charge, tip, notes, created_at, created_by,
           receipt_items(id, name, quantity, unit_price, total_price, sort_order, split_mode, split_n, sub_items),
           receipt_images(id),
           profiles:created_by(full_name, username)`
        )
        .eq("group_id", id)
        .order("created_at", { ascending: false })
        .limit(50);
      receipts = withoutPaidBy.data;
      receiptsError = withoutPaidBy.error;
    }

    if (receiptsError && /split_mode|split_n|column/i.test(receiptsError.message)) {
      const fallback = await supabase
        .from("receipts")
        .select(
          `id, merchant, total, currency, status, receipt_date, receipt_time,
           subtotal, tax, discount, service_charge, tip, notes, created_at, created_by,
           receipt_items(id, name, quantity, unit_price, total_price, sort_order),
           receipt_images(id),
           profiles:created_by(full_name, username)`
        )
        .eq("group_id", id)
        .order("created_at", { ascending: false })
        .limit(50);
      receipts = fallback.data;
      receiptsError = fallback.error;
    }
    if (receiptsError) return fail(receiptsError.message, 400);

    const receiptIds = (receipts ?? []).map((r: { id: string }) => r.id);
    const discountsByReceipt = await fetchReceiptDiscountsByReceiptIds(
      supabase,
      receiptIds
    );

    // Attach claimers so members can hide taken exclusive items
    const allItemIds = (receipts ?? []).flatMap((r) =>
      (r.receipt_items ?? []).map((i: { id: string }) => i.id)
    );
    const claimersByItem = new Map<string, string[]>();
    const claimedQtyByItem = new Map<string, number>();
    const claimsDetailByItem = new Map<
      string,
      Array<{ member_id: string; quantity: number }>
    >();
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
    if (allItemIds.length) {
      const { data: assigns } = await supabase
        .from("receipt_item_assignments")
        .select(
          "receipt_item_id, member_id, split_method, share_percentage, share_quantity, share_amount"
        )
        .in("receipt_item_id", allItemIds);
      for (const a of assigns ?? []) {
        const list = claimersByItem.get(a.receipt_item_id) ?? [];
        list.push(a.member_id);
        claimersByItem.set(a.receipt_item_id, list);
        const qty = Number(a.share_quantity ?? 0) || 1;
        claimedQtyByItem.set(
          a.receipt_item_id,
          (claimedQtyByItem.get(a.receipt_item_id) ?? 0) + qty
        );
        const detail = claimsDetailByItem.get(a.receipt_item_id) ?? [];
        detail.push({ member_id: a.member_id, quantity: qty });
        claimsDetailByItem.set(a.receipt_item_id, detail);

        const asgList = assignmentsByItem.get(a.receipt_item_id) ?? [];
        asgList.push({
          member_id: a.member_id,
          split_method: (a.split_method as AssignmentInput["splitMethod"]) ?? "quantity",
          share_percentage:
            a.share_percentage != null ? Number(a.share_percentage) : null,
          share_quantity:
            a.share_quantity != null ? Number(a.share_quantity) : null,
          share_amount: a.share_amount != null ? Number(a.share_amount) : null,
        });
        assignmentsByItem.set(a.receipt_item_id, asgList);
      }
    }

    const memberNameById = new Map<string, string>();
    for (const m of members ?? []) {
      const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
      const name =
        (p as { full_name?: string | null; username?: string | null } | null)?.full_name ||
        (p as { username?: string | null } | null)?.username ||
        m.guest_name ||
        "Member";
      memberNameById.set(m.id, name);
    }

    const detailed = (receipts ?? []).map((r) => {
      const profile = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
      const items = [...(r.receipt_items ?? [])].sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
      );
      return {
        id: r.id,
        merchant: r.merchant,
        total: r.total,
        currency: r.currency,
        status: r.status,
        receipt_date: r.receipt_date,
        receipt_time: r.receipt_time,
        subtotal: r.subtotal,
        tax: r.tax,
        discount: r.discount,
        discounts: normalizeDiscountRows(
          discountsByReceipt.get(r.id) ?? [],
          Number(r.discount)
        ).map((d) => ({ label: d.label, amount: d.amount })),
        service_charge: r.service_charge,
        tip: r.tip,
        notes: r.notes,
        created_at: r.created_at,
        created_by: r.created_by,
        paid_by_member_id:
          (r as { paid_by_member_id?: string | null }).paid_by_member_id ?? null,
        uploaded_by:
          profile?.full_name || profile?.username || "Member",
        has_image: (r.receipt_images?.length ?? 0) > 0,
        image_url: (r.receipt_images?.length ?? 0) > 0 ? `/api/receipts/${r.id}/image` : null,
        items: items.map((i) => {
          const claimerIds = claimersByItem.get(i.id) ?? [];
          const itemQty = Number(i.quantity);
          const claimedQty = claimedQtyByItem.get(i.id) ?? 0;
          const details = claimsDetailByItem.get(i.id) ?? [];
          const mode =
            (i as { split_mode?: string }).split_mode ?? "among_n";
          const splitN = (i as { split_n?: number | null }).split_n ?? 1;
          // Multi-way split: remaining = unused shares of N (not receipt line qty)
          const poolSize =
            mode === "among_n" && Number(splitN) > 1
              ? Math.max(1, Math.floor(Number(splitN)))
              : itemQty;
          return {
            id: i.id,
            name: i.name,
            quantity: itemQty,
            unit_price: Number(i.unit_price),
            total_price: Number(i.total_price),
            split_mode: mode,
            split_n: splitN,
            sub_items: normalizeSubItems(
              (i as { sub_items?: unknown }).sub_items
            ),
            claimer_ids: claimerIds,
            claimed_by: claimerIds.map((id) => memberNameById.get(id) ?? "Member"),
            claimed_quantity: claimedQty,
            remaining_quantity: Math.max(0, poolSize - claimedQty),
            claims: details.map((d) => ({
              member_id: d.member_id,
              name: memberNameById.get(d.member_id) ?? "Member",
              quantity: d.quantity,
            })),
          };
        }),
      };
    });

    const isCreator = group.created_by === user.id;
    let pending_claim_receipts: typeof detailed = [];

    // Non-creators must confirm picks on each receipt before viewing the group
    if (!isCreator && my && detailed.length) {
      const withItems = detailed.filter((r) => r.items.length > 0);
      const receiptIds = withItems.map((r) => r.id);
      if (receiptIds.length) {
        const { data: confirmed } = await supabase
          .from("receipt_history")
          .select("receipt_id")
          .eq("user_id", user.id)
          .eq("event", "claims_confirmed")
          .in("receipt_id", receiptIds);

        const confirmedSet = new Set((confirmed ?? []).map((c) => c.receipt_id));
        pending_claim_receipts = withItems.filter((r) => !confirmedSet.has(r.id));
      }
    }

    // Per-member totals + claimed items (shown on the Members list)
    const memberIds = (members ?? []).map((m) => m.id);
    const memberPayAcc = new Map<
      string,
      {
        total: number;
        owes: number;
        is_bill_payer: boolean;
        currency: string;
        items: Array<{
          name: string;
          quantity: number;
          amount: number;
          merchant: string | null;
          sub_items?: ReturnType<typeof normalizeSubItems>;
        }>;
      }
    >();

    for (const mid of memberIds) {
      memberPayAcc.set(mid, {
        total: 0,
        owes: 0,
        is_bill_payer: false,
        currency: "PHP",
        items: [],
      });
    }

    const defaultPayerMemberId =
      (members ?? []).find((m) => m.role === "owner")?.id ??
      (members ?? []).find((m) => m.user_id === group.created_by)?.id ??
      null;

    const subItemsByItemId = new Map<string, ReturnType<typeof normalizeSubItems>>();
    for (const r of detailed) {
      for (const item of r.items) {
        subItemsByItemId.set(
          item.id,
          normalizeSubItems((item as { sub_items?: unknown }).sub_items)
        );
      }
    }

    for (const r of detailed) {
      const paidBy = resolveReceiptPayerMemberId(
        (r as { paid_by_member_id?: string | null }).paid_by_member_id,
        defaultPayerMemberId
      );
      const splitItems: ItemSplitInput[] = r.items.map((item) => {
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

      const currency = r.currency || "PHP";
      for (const share of summary.members) {
        const acc = memberPayAcc.get(share.memberId);
        if (!acc) continue;
        acc.currency = currency;
        acc.total = moneyNumber(acc.total + share.total);
        if (paidBy && paidBy === share.memberId) {
          acc.is_bill_payer = true;
        } else if (share.total > 0) {
          acc.owes = moneyNumber(acc.owes + share.total);
        }
        for (const line of share.lines) {
          const asg = (assignmentsByItem.get(line.itemId) ?? []).find(
            (a) => a.member_id === share.memberId
          );
          const qty =
            asg?.share_quantity != null && asg.share_quantity > 0
              ? Number(asg.share_quantity)
              : 1;
          acc.items.push({
            name: line.itemName,
            quantity: qty,
            amount: moneyNumber(line.amount),
            merchant: r.merchant,
            ...(subItemsByItemId.get(line.itemId)?.length
              ? { sub_items: subItemsByItemId.get(line.itemId) }
              : {}),
          });
        }
        for (const adj of memberAdjustmentLines(
          share.memberId,
          share.itemsSubtotal,
          summary.assignedTotal,
          {
            tax: Number(r.tax),
            discount: Number(r.discount),
            serviceCharge: Number(r.service_charge),
            tip: Number(r.tip),
          },
          memberIds
        )) {
          acc.items.push({
            name: adj.name,
            quantity: 1,
            amount: moneyNumber(adj.amount),
            merchant: r.merchant,
          });
        }
      }
    }

    const member_payments = memberIds.map((mid) => {
      const acc = memberPayAcc.get(mid)!;
      return {
        member_id: mid,
        total: moneyNumber(acc.total),
        owes: moneyNumber(acc.owes),
        is_bill_payer: acc.is_bill_payer,
        currency: acc.currency,
        items: acc.items,
      };
    });

    const my_payment = my
      ? (() => {
          const mine = member_payments.find((p) => p.member_id === my.id);
          if (!mine) {
            return { total: 0, currency: "PHP", receipts: [] as Array<{
              receipt_id: string;
              merchant: string | null;
              amount: number;
              currency: string;
            }> };
          }
          // Group item amounts by merchant for backward-compatible receipt list
          const byMerchant = new Map<string, { merchant: string | null; amount: number; currency: string }>();
          for (const item of mine.items) {
            const key = item.merchant ?? "Receipt";
            const prev = byMerchant.get(key);
            if (prev) prev.amount = moneyNumber(prev.amount + item.amount);
            else
              byMerchant.set(key, {
                merchant: item.merchant,
                amount: item.amount,
                currency: mine.currency,
              });
          }
          return {
            total: mine.total,
            owes: mine.owes,
            is_bill_payer: mine.is_bill_payer,
            currency: mine.currency,
            receipts: [...byMerchant.values()].map((row, i) => ({
              receipt_id: `agg-${i}`,
              merchant: row.merchant,
              amount: row.amount,
              currency: row.currency,
            })),
          };
        })()
      : null;

    const canManageMembers =
      isCreator || my?.role === "owner" || my?.role === "admin";
    const membersVisible =
      Boolean(
        (group as { members_visible_to_group?: boolean }).members_visible_to_group
      ) || canManageMembers;

    // Privacy: the owner may share the member list, but payment balances remain
    // private. Non-managers only receive their own total.
    const visibleMembers = membersVisible
      ? members ?? []
      : (members ?? []).filter((m) => m.id === my?.id);
    const visiblePayments = canManageMembers
      ? member_payments
      : member_payments.filter((p) => p.member_id === my?.id);

    // Redact other people's names on receipts when private — keep ids/qty so pick-list availability stays correct
    const receiptsForClient = membersVisible
      ? detailed
      : detailed.map((r) => ({
          ...r,
          items: r.items.map((item) => {
            const claims = (item.claims ?? []).map((c) =>
              c.member_id === my?.id
                ? c
                : { ...c, name: "Someone" }
            );
            const myClaims = claims.filter((c) => c.member_id === my?.id);
            const othersCount = claims.length - myClaims.length;
            return {
              ...item,
              claims,
              claimed_by: claims.map((c) => c.name),
              claimers_hidden: othersCount > 0 && !membersVisible,
              others_claim_count: othersCount,
            };
          }),
        }));

    // Where members should send payment (bill payers' receiving accounts)
    const memberById = new Map((members ?? []).map((m) => [m.id, m]));
    const payerIds = new Set<string>();
    for (const r of receipts ?? []) {
      const paidBy = (r as { paid_by_member_id?: string | null }).paid_by_member_id;
      if (paidBy) payerIds.add(paidBy);
    }
    if (payerIds.size === 0) {
      const owner =
        (members ?? []).find((m) => m.role === "owner") ||
        (members ?? []).find((m) => m.user_id === group.created_by);
      if (owner) payerIds.add(owner.id);
    }

    const allMemberMethods: Array<{
      userId: string;
      method: ReturnType<typeof normalizePaymentMethods>[number];
    }> = [];
    for (const member of members ?? []) {
      const p = Array.isArray(member.profiles)
        ? member.profiles[0]
        : member.profiles;
      const profile = p as {
        id?: string;
        payment_methods?: unknown;
      } | null;
      const userId = member.user_id ?? profile?.id;
      if (!userId) continue;
      for (const method of normalizePaymentMethods(profile?.payment_methods)) {
        allMemberMethods.push({ userId, method });
      }
    }

    async function enrichMethodQr(
      payerUserId: string | null,
      method: ReturnType<typeof normalizePaymentMethods>[number]
    ) {
      if (method.qr_code_url) return method;

      if (payerUserId) {
        const fromPayerStorage = await resolvePaymentQrUrl(
          supabase,
          payerUserId,
          method.id,
          null
        );
        if (fromPayerStorage) return { ...method, qr_code_url: fromPayerStorage };
      }

      const number = method.account_number.trim();
      if (number) {
        const match = allMemberMethods.find(
          (row) =>
            row.method.account_number.trim() === number &&
            Boolean(row.method.qr_code_url)
        );
        if (match?.method.qr_code_url) {
          return { ...method, qr_code_url: match.method.qr_code_url };
        }

        for (const row of allMemberMethods) {
          if (row.method.account_number.trim() !== number) continue;
          const fromStorage = await resolvePaymentQrUrl(
            supabase,
            row.userId,
            row.method.id,
            null
          );
          if (fromStorage) return { ...method, qr_code_url: fromStorage };
        }
      }

      // Last resort: current user's uploaded QR (same payout number / single file)
      const fromMe = await resolvePaymentQrUrl(
        supabase,
        user.id,
        method.id,
        null
      );
      if (fromMe) return { ...method, qr_code_url: fromMe };

      return method;
    }

    const where_to_pay = (
      await Promise.all(
        [...payerIds].map(async (payerId) => {
          const m = memberById.get(payerId);
          const p = Array.isArray(m?.profiles) ? m?.profiles[0] : m?.profiles;
          const profile = p as {
            id?: string;
            full_name?: string | null;
            username?: string | null;
            payment_methods?: unknown;
          } | null;
          const name =
            profile?.full_name ||
            profile?.username ||
            m?.guest_name ||
            "Payer";
          const payerUserId = m?.user_id ?? profile?.id ?? null;
          const methods = toSharedPaymentMethods(
            await Promise.all(
              normalizePaymentMethods(profile?.payment_methods).map((method) =>
                method.show_qr
                  ? enrichMethodQr(payerUserId, method)
                  : Promise.resolve(method)
              )
            )
          );
          return {
            member_id: payerId,
            name,
            methods,
          };
        })
      )
    ).filter((row) => row.methods.length > 0);

    let inviteCode = String(group.invite_code ?? "");
    if (
      canManageMembers &&
      inviteCode.length !== GROUP_INVITE_CODE_LENGTH
    ) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const next = generateGroupInviteCode();
        const { data: updated, error: updateError } = await supabase
          .from("groups")
          .update({ invite_code: next })
          .eq("id", id)
          .select("invite_code")
          .maybeSingle();
        if (!updateError && updated?.invite_code) {
          inviteCode = updated.invite_code;
          break;
        }
        if (updateError && !isUniqueInviteCodeViolation(updateError)) break;
      }
    }

    const appUrl = groupInviteUrlFromRequest(inviteCode, req);

    let payment_proofs: Array<{
      member_id: string;
      status: string;
      expected_amount: number;
      ocr_amount: number | null;
      ocr_date: string | null;
      validated_at: string | null;
      rejection_reason: string | null;
      manual: boolean;
      bill_payer: boolean;
      moved_to_pal: boolean;
    }> = [];
    {
      const proofsQuery = await supabase
        .from("group_payment_proofs")
        .select(
          "from_member_id, status, expected_amount, ocr_amount, ocr_date, validated_at, rejection_reason, ocr_raw"
        )
        .eq("group_id", id);
      if (!proofsQuery.error) {
        payment_proofs = (proofsQuery.data ?? []).map((p) => {
          const raw = p.ocr_raw as { source?: string } | null;
          return {
            member_id: p.from_member_id,
            status: p.status,
            expected_amount: Number(p.expected_amount),
            ocr_amount: p.ocr_amount != null ? Number(p.ocr_amount) : null,
            ocr_date: p.ocr_date,
            validated_at: p.validated_at,
            rejection_reason: p.rejection_reason,
            manual: raw?.source === "manual",
            bill_payer: raw?.source === "bill_payer",
            moved_to_pal: raw?.source === "moved_to_pal",
          };
        });
        // Managers always see all proofs so they can mark paid; others follow visibility
        if (!membersVisible && !canManageMembers) {
          payment_proofs = payment_proofs.filter(
            (p) => p.member_id === my?.id
          );
        }
      }
    }

    return ok({
      group: { ...group, invite_code: inviteCode },
      members: visibleMembers,
      member_count: membersVisible ? (members ?? []).length : visibleMembers.length,
      receipts: receiptsForClient,
      my_role: my?.role ?? null,
      my_member_id: my?.id ?? null,
      my_payment,
      member_payments: visiblePayments,
      where_to_pay,
      payment_proofs,
      members_visible_to_group: Boolean(
        (group as { members_visible_to_group?: boolean }).members_visible_to_group
      ),
      can_manage_members: canManageMembers,
      pending_claim_receipts,
      must_claim_before_view:
        !isCreator && pending_claim_receipts.length > 0,
      invite_url: appUrl,
    });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  photo_url: z.string().url().nullable().optional(),
  members_visible_to_group: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;
    const { id } = await params;
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    if (parsed.data.members_visible_to_group !== undefined) {
      const { data: me } = await supabase
        .from("group_members")
        .select("role")
        .eq("group_id", id)
        .eq("user_id", user.id)
        .maybeSingle();
      const { data: g } = await supabase
        .from("groups")
        .select("created_by")
        .eq("id", id)
        .maybeSingle();
      const allowed =
        g?.created_by === user.id ||
        me?.role === "owner" ||
        me?.role === "admin";
      if (!allowed) {
        return fail("Only the owner can change member visibility", 403);
      }
    }

    const { data, error } = await supabase
      .from("groups")
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      if (/members_visible_to_group|column/i.test(error.message)) {
        return fail(
          "Run migration 019_members_visible_to_group.sql in Supabase first.",
          400
        );
      }
      return fail(error.message, 400);
    }
    return ok(data);
  } catch (e) {
    console.error(e);
    return serverError();
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;
    const { id } = await params;

    const { data: group } = await supabase
      .from("groups")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (!group) return notFound("Group not found");

    const { data: me } = await supabase
      .from("group_members")
      .select("role")
      .eq("group_id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (me?.role !== "owner") {
      return fail("Only the group owner can delete this group", 403);
    }

    const { error } = await supabase.from("groups").delete().eq("id", id);
    if (error) return fail(error.message, 400);
    return ok({ deleted: true });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
