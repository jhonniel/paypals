import { z } from "zod";
import { getAuthedClient } from "@/lib/supabase/auth";
import { ok, created, unauthorized, fail, fromZod, serverError } from "@/lib/api";

export async function GET() {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;

    const { data, error } = await supabase
      .from("friends")
      .select(
        "id, status, requester_id, addressee_id, created_at, requester:requester_id(id, full_name, username, avatar_url, email), addressee:addressee_id(id, full_name, username, avatar_url, email)"
      )
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
      .order("created_at", { ascending: false });

    if (error) return fail(error.message, 400);
    return ok(data ?? []);
  } catch (e) {
    console.error(e);
    return serverError();
  }
}

const requestSchema = z.object({
  username: z.string().min(3).max(30).optional(),
  user_id: z.string().uuid().optional(),
  email: z.string().email().optional(),
}).refine((d) => d.username || d.user_id || d.email, {
  message: "Provide username, user_id, or email",
});

export async function POST(request: Request) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;

    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    let addresseeId = parsed.data.user_id ?? null;

    if (!addresseeId && parsed.data.username) {
      const { data: p } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", parsed.data.username)
        .maybeSingle();
      addresseeId = p?.id ?? null;
    }

    if (!addresseeId && parsed.data.email) {
      const { data: p } = await supabase
        .from("profiles")
        .select("id")
        .eq("email", parsed.data.email)
        .maybeSingle();
      addresseeId = p?.id ?? null;
    }

    if (!addresseeId) return fail("User not found", 404);
    if (addresseeId === user.id) return fail("Cannot friend yourself");

    const { data, error } = await supabase
      .from("friends")
      .insert({
        requester_id: user.id,
        addressee_id: addresseeId,
        status: "pending",
      })
      .select("*")
      .single();

    if (error) return fail(error.message, 400);

    await supabase.from("notifications").insert({
      user_id: addresseeId,
      type: "invitation",
      title: "Friend request",
      body: "Someone sent you a friend request on Paypals.",
      link: "/friends",
    });

    return created(data);
  } catch (e) {
    console.error(e);
    return serverError();
  }
}

const patchSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["accepted", "blocked", "pending"]),
});

export async function PATCH(request: Request) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    const { data, error } = await supabase
      .from("friends")
      .update({ status: parsed.data.status })
      .eq("id", parsed.data.id)
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
      .select("*")
      .single();

    if (error) return fail(error.message, 400);

    if (parsed.data.status === "accepted" && data) {
      const other =
        data.requester_id === user.id ? data.addressee_id : data.requester_id;
      await supabase.from("notifications").insert({
        user_id: other,
        type: "invitation",
        title: "Friend request accepted",
        body: "You are now friends on Paypals.",
        link: "/friends",
      });
    }

    return ok(data);
  } catch (e) {
    console.error(e);
    return serverError();
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return fail("id required");

    const { error } = await supabase
      .from("friends")
      .delete()
      .eq("id", id)
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);

    if (error) return fail(error.message, 400);
    return ok({ deleted: true });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
