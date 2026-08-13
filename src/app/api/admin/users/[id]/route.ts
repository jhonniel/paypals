import { z } from "zod";
import { getAdminClient, writeAuditLog } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminDeleteUser, countAdmins } from "@/lib/admin-delete-user";
import { ok, forbidden, serverError, fail, notFound, fromZod } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

const patchUserSchema = z.object({
  full_name: z.string().trim().min(1, "Name is required").max(120),
});

export async function PATCH(request: Request, { params }: Params) {
  try {
    const auth = await getAdminClient();
    if (!auth) return forbidden("Admin access required");
    const { supabase, user: actor } = auth;
    const { id: targetUserId } = await params;

    const body = await request.json();
    const parsed = patchUserSchema.safeParse(body);
    if (!parsed.success) return fromZod(parsed.error);

    const writer = process.env.SUPABASE_SERVICE_ROLE_KEY
      ? createAdminClient()
      : supabase;

    const { data: before } = await writer
      .from("profiles")
      .select("id, email, full_name, username")
      .eq("id", targetUserId)
      .maybeSingle();

    if (!before) return notFound("User not found");

    const full_name = parsed.data.full_name;

    const { data: updated, error } = await writer
      .from("profiles")
      .update({ full_name })
      .eq("id", targetUserId)
      .select("id, full_name, username, email")
      .maybeSingle();

    if (error) return fail(error.message, 400);
    if (!updated) {
      return fail(
        "Could not update name (0 rows). Run migration 021_profiles_admin_update.sql or set SUPABASE_SERVICE_ROLE_KEY.",
        400
      );
    }

    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const admin = createAdminClient();
        await admin.auth.admin.updateUserById(targetUserId, {
          user_metadata: { full_name },
        });
      } catch (err) {
        console.error("auth metadata sync failed", err);
      }
    }

    await writeAuditLog(supabase, "admin_rename_user", "profile", targetUserId, {
      actor_id: actor.id,
      before: before.full_name,
      after: full_name,
    });

    return ok({ updated });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const auth = await getAdminClient();
    if (!auth) return forbidden("Admin access required");
    const { supabase, user: actor } = auth;
    const { id: targetUserId } = await params;

    if (targetUserId === actor.id) {
      return fail("You cannot delete your own account from the admin panel", 400);
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return fail(
        "User deletion requires SUPABASE_SERVICE_ROLE_KEY on the server",
        503
      );
    }

    const admin = createAdminClient();

    const { data: target } = await admin
      .from("profiles")
      .select("id, email, full_name, username, is_admin")
      .eq("id", targetUserId)
      .maybeSingle();

    if (!target) return notFound("User not found");

    if (target.is_admin) {
      const adminCount = await countAdmins(admin);
      if (adminCount <= 1) {
        return fail("Cannot delete the last admin account", 400);
      }
    }

    const result = await adminDeleteUser(admin, targetUserId);
    if (result.error) return fail(result.error, 400);

    await writeAuditLog(supabase, "admin_delete_user", "profile", targetUserId, {
      email: target.email,
      full_name: target.full_name,
      username: target.username,
    });

    return ok({ deleted: true });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
