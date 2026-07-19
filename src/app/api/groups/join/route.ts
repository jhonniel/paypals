import { z } from "zod";
import { getAuthedClient } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, unauthorized, fail, fromZod, serverError, notFound } from "@/lib/api";

const joinSchema = z.object({
  code: z.string().min(4).max(64),
  /** Claim an owner-created seat instead of creating a new member row */
  member_id: z.string().uuid().optional(),
});

type OpenSeat = { member_id: string; guest_name: string };

function normalizeSeats(raw: unknown): OpenSeat[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const r = row as Record<string, unknown>;
      const member_id = String(r.member_id ?? r.memberId ?? r.id ?? "");
      const guest_name = String(r.guest_name ?? r.guestName ?? "").trim();
      if (!member_id || !guest_name) return null;
      return { member_id, guest_name };
    })
    .filter((s): s is OpenSeat => Boolean(s));
}

/** Always resolve open seats — RPC first, then service-role fallback */
async function loadOpenSeats(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userClient: { rpc: (fn: string, args: Record<string, unknown>) => Promise<any> },
  code: string
): Promise<{ seats: OpenSeat[]; source: "rpc" | "admin" | "none"; error?: string }> {
  const cleaned = code.trim();

  const seats = await userClient.rpc("get_open_seats_by_invite", { p_code: cleaned });
  if (!seats.error) {
    return { seats: normalizeSeats(seats.data), source: "rpc" };
  }

  const rpcError = seats.error.message as string;

  try {
    const admin = createAdminClient();
    const { data: group } = await admin
      .from("groups")
      .select("id")
      .ilike("invite_code", cleaned)
      .maybeSingle();

    if (!group) {
      return { seats: [], source: "none", error: rpcError };
    }

    const { data: members, error } = await admin
      .from("group_members")
      .select("id, guest_name, user_id")
      .eq("group_id", group.id)
      .is("user_id", null)
      .not("guest_name", "is", null);

    if (error) {
      return { seats: [], source: "none", error: error.message };
    }

    const list = (members ?? [])
      .map((m) => ({
        member_id: m.id as string,
        guest_name: String(m.guest_name ?? "").trim(),
      }))
      .filter((m) => m.guest_name.length > 0);

    return { seats: list, source: "admin", error: rpcError };
  } catch (e) {
    return {
      seats: [],
      source: "none",
      error: e instanceof Error ? e.message : rpcError,
    };
  }
}

/** Preview group by invite code (+ open seats to pick) */
export async function GET(request: Request) {
  try {
    const auth = await getAuthedClient();
    const code = new URL(request.url).searchParams.get("code");
    if (!code) return fail("code required");

    const client = auth?.supabase;
    if (!client) {
      return unauthorized("Sign in to view invites");
    }

    const { data, error } = await client.rpc("get_group_by_invite", {
      p_code: code,
    });

    if (error) return fail(error.message, 400);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return notFound("Invite not found");

    const { seats: openSeats, source, error: seatsError } = await loadOpenSeats(
      client,
      code
    );

    return ok({
      ...row,
      open_seats: openSeats,
      must_pick_name: openSeats.length > 0,
      seats_source: source,
      ...(seatsError && openSeats.length === 0 ? { seats_warning: seatsError } : {}),
    });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}

/** Join group by invite code (optionally claim a named seat) */
export async function POST(request: Request) {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;

    const parsed = joinSchema.safeParse(await request.json());
    if (!parsed.success) return fromZod(parsed.error);

    const { code, member_id } = parsed.data;
    const { seats: openSeats } = await loadOpenSeats(supabase, code);

    let groupId: string | null = null;

    if (member_id) {
      const { data, error } = await supabase.rpc("claim_seat_by_invite", {
        p_code: code,
        p_member_id: member_id,
      });

      if (error) {
        const { data: groupRow } = await supabase
          .from("groups")
          .select("id, created_by")
          .ilike("invite_code", code.trim())
          .maybeSingle();

        if (!groupRow) {
          // Admin fallback to resolve group id
          try {
            const admin = createAdminClient();
            const { data: g } = await admin
              .from("groups")
              .select("id, created_by")
              .ilike("invite_code", code.trim())
              .maybeSingle();
            if (!g) {
              return fail(
                /claim_seat|function|schema cache/i.test(error.message)
                  ? "Pick-name join isn’t set up yet. Run migration 017 + 018 in Supabase."
                  : error.message,
                400
              );
            }
            const claimed = await claimSeatDirect(admin, g.id, member_id, user.id);
            if (!claimed.ok) {
              return fail(claimed.message, 400);
            }
            groupId = g.id;
          } catch {
            return fail(error.message, 400);
          }
        } else {
          const claimed = await claimSeatDirect(supabase, groupRow.id, member_id, user.id);
          if (!claimed.ok) {
            try {
              const admin = createAdminClient();
              const adminClaimed = await claimSeatDirect(
                admin,
                groupRow.id,
                member_id,
                user.id
              );
              if (adminClaimed.ok) {
                groupId = groupRow.id;
              } else {
                const { data: existing } = await supabase
                  .from("group_members")
                  .select("id")
                  .eq("group_id", groupRow.id)
                  .eq("user_id", user.id)
                  .maybeSingle();
                if (existing) {
                  groupId = groupRow.id;
                } else {
                  return fail(adminClaimed.message || claimed.message || error.message, 400);
                }
              }
            } catch {
              return fail(claimed.message || error.message, 400);
            }
          } else {
            groupId = groupRow.id;
          }
        }
      } else {
        groupId = data as string;
      }
    } else {
      if (openSeats.length > 0) {
        return fail("Pick your name on the bill to join this group.", 400, "PICK_SEAT", {
          open_seats: openSeats,
          must_pick_name: true,
        });
      }

      const { data, error } = await supabase.rpc("join_group_by_invite", {
        p_code: code,
      });
      if (error) {
        if (/PICK_SEAT/i.test(error.message)) {
          const again = await loadOpenSeats(supabase, code);
          return fail("Pick your name on the bill to join this group.", 400, "PICK_SEAT", {
            open_seats: again.seats,
            must_pick_name: true,
          });
        }
        return fail(error.message, 400);
      }
      groupId = data as string;
    }

    if (!groupId) return fail("Join failed", 400);

    const { data: group } = await supabase
      .from("groups")
      .select("id, name, created_by")
      .eq("id", groupId)
      .single();

    if (group?.created_by) {
      await supabase.from("notifications").insert({
        user_id: group.created_by,
        type: "member_joined",
        title: "New member joined",
        body: `Someone joined ${group.name}.`,
        link: `/groups/${group.id}`,
      });
    }

    await supabase.from("notifications").insert({
      user_id: user.id,
      type: "invitation",
      title: `Welcome to ${group?.name ?? "the group"}`,
      body: member_id
        ? "You claimed your seat — next, pick what you ordered."
        : "You joined via invite link.",
      link: `/groups/${groupId}`,
    });

    return ok({ group_id: groupId, picked_seat: Boolean(member_id) });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}

async function claimSeatDirect(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: { from: (t: string) => any },
  groupId: string,
  memberId: string,
  userId: string
): Promise<{ ok: boolean; message: string }> {
  const { data: updated, error } = await client
    .from("group_members")
    .update({
      user_id: userId,
      claimed_at: new Date().toISOString(),
      invite_token: null,
    })
    .eq("id", memberId)
    .eq("group_id", groupId)
    .is("user_id", null)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, message: error.message };
  if (!updated) return { ok: false, message: "Seat not found or already claimed" };
  return { ok: true, message: "" };
}
