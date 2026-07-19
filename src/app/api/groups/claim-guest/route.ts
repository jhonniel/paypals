import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedClient } from "@/lib/supabase/auth";
import { ok, unauthorized, fail, fromZod, serverError, notFound } from "@/lib/api";

const schema = z.object({
  token: z.string().min(8).max(64),
});

/** Preview guest invite by token. */
export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token")?.trim() ?? "";
    if (token.length < 8) return fail("Invalid invite");

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_guest_invite", {
      p_token: token,
    });

    if (error) return fail(error.message, 400);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || row.claimed) return notFound("Invite not found or already claimed");

    return ok({
      memberId: row.member_id,
      guestName: row.guest_name,
      group: {
        id: row.group_id,
        name: row.group_name,
        description: row.group_description,
      },
    });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}

/** Claim guest seat after signup / login. */
export async function POST(request: Request) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    const { data: memberId, error } = await auth.supabase.rpc("claim_guest_invite", {
      p_token: parsed.data.token,
    });

    if (error) return fail(error.message, 400);

    const { data: member } = await auth.supabase
      .from("group_members")
      .select("group_id")
      .eq("id", memberId)
      .maybeSingle();

    await auth.supabase
      .from("profiles")
      .update({ invite_verified: true })
      .eq("id", auth.user.id);

    return ok({
      member_id: memberId,
      group_id: member?.group_id ?? null,
    });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
