import { z } from "zod";
import { getAuthedClient } from "@/lib/supabase/auth";
import { ok, unauthorized, fail, fromZod, serverError } from "@/lib/api";
import { sendAccessConfirmedEmail } from "@/lib/email/notify";
import { redeemSignupInviteForUser } from "@/lib/redeem-invite";

const schema = z.object({
  inviteCode: z.string().min(4).max(64),
});

export async function POST(request: Request) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    const result = await redeemSignupInviteForUser(
      supabase,
      parsed.data.inviteCode,
      user.id
    );

    if (!result.ok) {
      return fail(
        result.reason === "exhausted"
          ? "This invite has reached its limit"
          : "Invalid invite code — ask an admin for a signup invite",
        400,
        "INVALID_INVITE"
      );
    }

    if (user.email) {
      void sendAccessConfirmedEmail({
        to: user.email,
        name:
          (user.user_metadata?.full_name as string | undefined) ||
          (user.user_metadata?.name as string | undefined) ||
          null,
      }).catch(() => null);
    }

    return ok({
      redirectTo: "/dashboard",
    });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
