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

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
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

    const { data: members } = await supabase
      .from("group_members")
      .select(
        "id, role, user_id, guest_email, guest_name, invite_token, claimed_at, joined_at, profiles:user_id(id, full_name, username, avatar_url, email)"
      )
      .eq("group_id", id)
      .order("joined_at", { ascending: true });

    const my = (members ?? []).find((m) => m.user_id === user.id);

    const { data: receipts } = await supabase
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
        service_charge: r.service_charge,
        tip: r.tip,
        notes: r.notes,
        created_at: r.created_at,
        created_by: r.created_by,
        uploaded_by:
          profile?.full_name || profile?.username || "Member",
        has_image: (r.receipt_images?.length ?? 0) > 0,
        image_url: (r.receipt_images?.length ?? 0) > 0 ? `/api/receipts/${r.id}/image` : null,
        items: items.map((i) => ({
          id: i.id,
          name: i.name,
          quantity: Number(i.quantity),
          unit_price: Number(i.unit_price),
          total_price: Number(i.total_price),
        })),
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

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

    return ok({
      group,
      members: members ?? [],
      receipts: detailed,
      my_role: my?.role ?? null,
      my_member_id: my?.id ?? null,
      pending_claim_receipts,
      must_claim_before_view:
        !isCreator && pending_claim_receipts.length > 0,
      invite_url: `${appUrl}/invite/${group.invite_code}`,
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
});

export async function PATCH(request: Request, { params }: Params) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase } = auth;
    const { id } = await params;
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    const { data, error } = await supabase
      .from("groups")
      .update(parsed.data)
      .eq("id", id)
      .select("*")
      .single();

    if (error) return fail(error.message, 400);
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
    const { supabase } = auth;
    const { id } = await params;

    const { error } = await supabase.from("groups").delete().eq("id", id);
    if (error) return fail(error.message, 400);
    return ok({ deleted: true });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
