import { z } from "zod";
import { getAuthedClient } from "@/lib/supabase/auth";
import { ok, unauthorized, notFound, fail, fromZod, serverError } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

const itemSchema = z.object({
  id: z.string().uuid(),
  split_mode: z.enum(["among_claimers", "among_group", "among_n"]),
  split_n: z.number().int().min(1).max(99).nullable().optional(),
});

const schema = z.object({
  items: z.array(itemSchema).min(1),
});

/** Owner sets how each line item is split (claimers / whole group / fixed N). */
export async function PUT(request: Request, { params }: Params) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;
    const { id } = await params;

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    const { data: receipt } = await supabase
      .from("receipts")
      .select("id, created_by, group_id")
      .eq("id", id)
      .maybeSingle();

    if (!receipt) return notFound("Receipt not found");
    if (receipt.created_by !== user.id) {
      return fail("Only the receipt owner can set split rules", 403);
    }

    for (const item of parsed.data.items) {
      const splitN =
        item.split_mode === "among_n" ? (item.split_n ?? null) : null;
      if (item.split_mode === "among_n" && (!splitN || splitN < 1)) {
        return fail("Set how many ways to split (e.g. 2, 3, 4)", 400);
      }

      const { error } = await supabase
        .from("receipt_items")
        .update({
          split_mode: item.split_mode,
          split_n: splitN,
        })
        .eq("id", item.id)
        .eq("receipt_id", id);

      if (error) {
        if (/split_mode|split_n|column/i.test(error.message)) {
          return fail(
            "Apply migration 011_item_split_modes.sql in Supabase, then retry",
            400
          );
        }
        return fail(error.message, 400);
      }
    }

    // If any item is whole-group, ensure every member is assigned equally
    const groupModes = parsed.data.items.filter((i) => i.split_mode === "among_group");
    if (groupModes.length && receipt.group_id) {
      const { data: members } = await supabase
        .from("group_members")
        .select("id")
        .eq("group_id", receipt.group_id);
      const memberIds = (members ?? []).map((m) => m.id);
      if (memberIds.length) {
        for (const item of groupModes) {
          await supabase
            .from("receipt_item_assignments")
            .delete()
            .eq("receipt_item_id", item.id);
          const { error: insErr } = await supabase
            .from("receipt_item_assignments")
            .insert(
              memberIds.map((memberId) => ({
                receipt_item_id: item.id,
                member_id: memberId,
                split_method: "equal",
                share_percentage: null,
                share_quantity: null,
                share_amount: null,
              }))
            );
          if (insErr) return fail(insErr.message, 400);
        }
      }
    }

    return ok({ saved: true });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
