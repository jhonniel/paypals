import { z } from "zod";
import { getAuthedClient } from "@/lib/supabase/auth";
import { ok, created, unauthorized, fail, fromZod, serverError } from "@/lib/api";
import {
  getGroupMemberPayments,
  isMemberMarkedPaid,
  parsePaymentProofSource,
} from "@/lib/group-member-payments";

export async function GET() {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;

    const { data: memberships, error } = await supabase
      .from("group_members")
      .select(
        "id, role, group_id, groups(id, name, description, photo_url, invite_code, created_by, created_at)"
      )
      .eq("user_id", user.id);

    if (error) return fail(error.message, 400);

    const groups = await Promise.all(
      (memberships ?? []).map(async (m) => {
        const g = m.groups as unknown as
          | Record<string, unknown>
          | Record<string, unknown>[]
          | null;
        const group = Array.isArray(g) ? g[0] : g;
        if (!group) return null;

        const { data: groupMembers } = await supabase
          .from("group_members")
          .select("id")
          .eq("group_id", m.group_id);
        const memberIds = (groupMembers ?? []).map((member) => member.id);
        const payments = await getGroupMemberPayments(
          supabase,
          m.group_id as string,
          memberIds
        );
        const pay = payments.find((payment) => payment.member_id === m.id);
        const payTotal = pay?.total ?? 0;
        const owesTotal = pay?.owes ?? payTotal;
        const isBillPayer = pay?.is_bill_payer ?? false;
        const currency = pay?.currency ?? "PHP";

        let unpaid = owesTotal;
        let paid = false;

        const { data: proof } = await supabase
          .from("group_payment_proofs")
          .select("status, expected_amount, ocr_raw")
          .eq("group_id", m.group_id)
          .eq("from_member_id", m.id)
          .maybeSingle();

        if (owesTotal > 0 || isBillPayer) {
          const proofMeta = parsePaymentProofSource(proof?.ocr_raw);
          paid = isMemberMarkedPaid(
            owesTotal,
            proof
              ? {
                  status: proof.status,
                  expected_amount: Number(proof.expected_amount),
                  ...proofMeta,
                }
              : null
          );
          if (paid && owesTotal > 0) unpaid = 0;
        }

        return {
          ...group,
          my_role: m.role,
          my_owes: unpaid,
          my_share: payTotal,
          my_currency: currency,
          my_paid: paid && (owesTotal > 0 || isBillPayer),
          my_is_bill_payer: isBillPayer,
          my_receipts: pay?.receipts ?? [],
        };
      })
    );

    const sorted = groups
      .filter(Boolean)
      .sort((a, b) => {
        const aTime = a?.created_at
          ? new Date(String(a.created_at)).getTime()
          : 0;
        const bTime = b?.created_at
          ? new Date(String(b.created_at)).getTime()
          : 0;
        return bTime - aTime;
      });

    return ok(sorted);
  } catch (e) {
    console.error(e);
    return serverError();
  }
}

const createSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;

    const body = await request.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return fromZod(parsed.error);

    const inviteCode = crypto.randomUUID().replace(/-/g, "").slice(0, 12);

    const { data: group, error } = await supabase
      .from("groups")
      .insert({
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        created_by: user.id,
        invite_code: inviteCode,
      })
      .select("*")
      .single();

    if (error) return fail(error.message, 400);

    const { error: memberError } = await supabase.from("group_members").insert({
      group_id: group.id,
      user_id: user.id,
      role: "owner",
    });

    if (memberError) return fail(memberError.message, 400);

    await supabase.from("activities").insert({
      user_id: user.id,
      group_id: group.id,
      action: "group_created",
      metadata: { name: group.name },
    });

    return created({ ...group, my_role: "owner" });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
