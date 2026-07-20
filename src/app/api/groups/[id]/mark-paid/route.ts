import { z } from "zod";
import { getAuthedClient } from "@/lib/supabase/auth";
import {
  fail,
  unauthorized,
  notFound,
  serverError,
  ok,
  fromZod,
} from "@/lib/api";
import { moneyNumber } from "@/lib/money";
import { getMemberGroupPayTotal } from "@/lib/group-member-payments";
import { todayInManila } from "@/lib/payment-proof";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  member_id: z.string().uuid(),
  /** true = mark paid, false = clear / unpaid */
  paid: z.boolean(),
});

/**
 * Owner/admin manually marks a member as paid (or clears the paid status).
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;
    const { id: groupId } = await params;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fromZod(parsed.error);

    const { data: me } = await supabase
      .from("group_members")
      .select("id, role")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!me || (me.role !== "owner" && me.role !== "admin")) {
      return fail("Only the group owner or admin can mark payments", 403);
    }

    const { data: target } = await supabase
      .from("group_members")
      .select("id, group_id")
      .eq("id", parsed.data.member_id)
      .eq("group_id", groupId)
      .maybeSingle();

    if (!target) return notFound("Member not found in this group");

    if (!parsed.data.paid) {
      const { error } = await supabase
        .from("group_payment_proofs")
        .delete()
        .eq("group_id", groupId)
        .eq("from_member_id", target.id);

      if (error) {
        // Fallback: mark rejected if delete not allowed
        const { error: upErr } = await supabase
          .from("group_payment_proofs")
          .update({
            status: "rejected",
            rejection_reason: "Cleared by owner",
            validated_at: null,
          })
          .eq("group_id", groupId)
          .eq("from_member_id", target.id);
        if (upErr) return fail(upErr.message, 400);
      }

      return ok({ member_id: target.id, status: "unpaid" });
    }

    const pay = await getMemberGroupPayTotal(supabase, groupId, target.id);
    if (!pay) return notFound("Could not compute member payment");
    if (pay.total <= 0) {
      return fail("This member has nothing to pay", 400);
    }

    // Prefer bill payer as to_member when available
    const { data: receipts } = await supabase
      .from("receipts")
      .select("paid_by_member_id")
      .eq("group_id", groupId)
      .not("paid_by_member_id", "is", null)
      .limit(1);

    const toMemberId =
      (receipts ?? []).find((r) => r.paid_by_member_id)?.paid_by_member_id ??
      me.id;

    const row = {
      group_id: groupId,
      from_member_id: target.id,
      to_member_id: toMemberId,
      expected_amount: moneyNumber(pay.total),
      ocr_amount: moneyNumber(pay.total),
      ocr_date: todayInManila(),
      currency: pay.currency || "PHP",
      status: "paid" as const,
      proof_storage_path: null,
      proof_mime: null,
      rejection_reason: null,
      ocr_raw: {
        source: "manual",
        marked_by: user.id,
        marked_at: new Date().toISOString(),
      },
      validated_at: new Date().toISOString(),
    };

    const { data: saved, error } = await supabase
      .from("group_payment_proofs")
      .upsert(row, { onConflict: "group_id,from_member_id" })
      .select("id, status, expected_amount, validated_at")
      .maybeSingle();

    if (error) {
      return fail(
        `${error.message}. If insert failed, run migration 022_manual_mark_paid.sql.`,
        400
      );
    }

    return ok({
      member_id: target.id,
      status: "paid",
      expected_amount: saved?.expected_amount ?? pay.total,
      validated_at: saved?.validated_at ?? null,
    });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
