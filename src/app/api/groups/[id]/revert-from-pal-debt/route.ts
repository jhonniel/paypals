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
import { recalculatePalDebtorAllocations } from "@/lib/pal-debt-balance";
import {
  getPalDebtWriter,
  resolveBillPayerMemberId,
  revertGroupMemberFromPalDebt,
} from "@/lib/move-group-to-pal-debt";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  member_id: z.string().uuid(),
});

/** Undo "Move to Pal owes me" for a group member. */
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

    if (!me) {
      return fail("You must be a member of this group", 403);
    }

    const toMemberId = await resolveBillPayerMemberId(supabase, groupId, me.id);
    const isBillPayer = me.id === toMemberId;
    const canRevert =
      me.role === "owner" || me.role === "admin" || isBillPayer;

    if (!canRevert) {
      return fail(
        "Only the group owner, admin, or bill payer can revert this move",
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
      return fail("Bill payer must be a registered user", 400);
    }

    const creditorId = payerMember.user_id as string;
    const writer = getPalDebtWriter(supabase, creditorId, user.id);

    if (!writer) {
      return fail(
        "Only the bill payer can revert this move. Ask whoever paid the bill.",
        403
      );
    }

    const result = await revertGroupMemberFromPalDebt(
      {
        supabase,
        userId: user.id,
        groupId,
        groupName: group.name,
        toMemberId,
        creditorId,
        writer,
      },
      parsed.data.member_id
    );

    if (result.debtor_id) {
      try {
        await recalculatePalDebtorAllocations(
          supabase,
          creditorId,
          result.debtor_id
        );
      } catch (e) {
        console.error("recalculatePalDebtorAllocations after revert", e);
      }
    }

    return ok(result);
  } catch (e) {
    console.error(e);
    return fail(e instanceof Error ? e.message : "Could not revert move", 400);
  }
}
