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
import {
  getPalDebtWriter,
  moveGroupMemberToPalDebt,
  resolveBillPayerMemberId,
} from "@/lib/move-group-to-pal-debt";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    member_id: z.string().uuid().optional(),
    member_ids: z.array(z.string().uuid()).min(1).max(50).optional(),
  })
  .refine((data) => data.member_id || (data.member_ids?.length ?? 0) > 0, {
    message: "Provide member_id or member_ids",
  });

/** Move one or more members' open group balances to Pal owes me. */
export async function POST(request: Request, { params }: Params) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;
    const { id: groupId } = await params;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fromZod(parsed.error);

    const memberIds = [
      ...new Set(
        parsed.data.member_ids?.length
          ? parsed.data.member_ids
          : parsed.data.member_id
            ? [parsed.data.member_id]
            : []
      ),
    ];

    const { data: me } = await supabase
      .from("group_members")
      .select("id, role")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!me) {
      return fail("You must be a member of this group", 403);
    }

    const toMemberId = await resolveBillPayerMemberId(supabase, groupId, me.id);
    const isBillPayer = me.id === toMemberId;
    const canMove =
      me.role === "owner" || me.role === "admin" || isBillPayer;

    if (!canMove) {
      return fail(
        "Only the group owner, admin, or bill payer can move balances",
        403
      );
    }

    const { data: group } = await supabase
      .from("groups")
      .select("id, name")
      .eq("id", groupId)
      .maybeSingle();

    if (!group) return notFound("Group not found");

    const { data: payerMember } = await supabase
      .from("group_members")
      .select("user_id")
      .eq("id", toMemberId)
      .maybeSingle();

    if (!payerMember?.user_id) {
      return fail("Bill payer must be a registered user to use Pal owes me", 400);
    }

    const creditorId = payerMember.user_id as string;
    const writer = getPalDebtWriter(supabase, creditorId, user.id);

    if (!writer) {
      return fail(
        "Only the bill payer can move balances to Pal owes me. Ask whoever paid the bill to do this move.",
        403
      );
    }

    const ctx = {
      supabase,
      userId: user.id,
      groupId,
      groupName: group.name,
      toMemberId,
      creditorId,
      writer,
    };

    const moved: Awaited<ReturnType<typeof moveGroupMemberToPalDebt>>[] = [];
    const failed: Array<{ member_id: string; error: string }> = [];

    for (const memberId of memberIds) {
      try {
        moved.push(await moveGroupMemberToPalDebt(ctx, memberId));
      } catch (e) {
        failed.push({
          member_id: memberId,
          error: e instanceof Error ? e.message : "Failed",
        });
      }
    }

    if (moved.length === 0) {
      return fail(failed[0]?.error ?? "Could not move any balances", 400);
    }

    const totalAmount = moneyNumber(moved.reduce((sum, row) => sum + row.amount, 0));

    return ok({
      moved,
      failed,
      count: moved.length,
      total_amount: totalAmount,
      currency: moved[0]?.currency ?? "PHP",
    });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
