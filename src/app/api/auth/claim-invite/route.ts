import { z } from "zod";
import { getAuthedClient } from "@/lib/supabase/auth";
import { ok, unauthorized, fail, fromZod, serverError } from "@/lib/api";

const schema = z.object({
  inviteCode: z.string().min(4).max(64),
});

export async function POST(request: Request) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase } = auth;

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    const { data, error } = await supabase.rpc("redeem_signup_invite", {
      p_code: parsed.data.inviteCode,
    });

    if (error) return fail(error.message, 400);

    const result = data as { ok?: boolean; reason?: string; group_id?: string };
    if (!result?.ok) {
      return fail(
        result?.reason === "exhausted"
          ? "This invite has reached its limit"
          : "Invalid invite code — ask an admin for a signup invite",
        400,
        "INVALID_INVITE"
      );
    }

    return ok({
      redirectTo: "/dashboard",
    });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
