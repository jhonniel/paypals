import { getAuthedClient, writeAuditLog } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, unauthorized, forbidden, serverError, fail } from "@/lib/api";

export async function GET() {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;

    const { data: flag } = await supabase
      .from("feature_flags")
      .select("enabled")
      .eq("key", "export_data")
      .maybeSingle();

    if (flag && flag.enabled === false) {
      return forbidden("Data export is disabled");
    }

    const [
      profile,
      settings,
      receipts,
      memberships,
      friends,
      notifications,
      activities,
    ] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase.from("user_settings").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("receipts").select("*, receipt_items(*), receipt_images(*)").eq("created_by", user.id),
      supabase
        .from("group_members")
        .select("*, groups(*)")
        .eq("user_id", user.id),
      supabase
        .from("friends")
        .select("*")
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`),
      supabase.from("notifications").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(200),
      supabase.from("activities").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(200),
    ]);

    await writeAuditLog(supabase, "export_data", "profile", user.id);

    const payload = {
      exported_at: new Date().toISOString(),
      version: 1,
      profile: profile.data,
      settings: settings.data,
      receipts: receipts.data,
      groups: memberships.data,
      friends: friends.data,
      notifications: notifications.data,
      activities: activities.data,
    };

    return new Response(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="paypals-export-${user.id.slice(0, 8)}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}

export async function DELETE() {
  try {
    const auth = await getAuthedClient();
    if (!auth) return unauthorized();
    const { supabase, user } = auth;

    const { data: flag } = await supabase
      .from("feature_flags")
      .select("enabled")
      .eq("key", "delete_account")
      .maybeSingle();

    if (flag && flag.enabled === false) {
      return forbidden("Account deletion is disabled");
    }

    await writeAuditLog(supabase, "delete_account_requested", "profile", user.id);

    // Remove storage objects under user prefixes
    try {
      const admin = createAdminClient();
      for (const bucket of ["avatars", "receipts", "ocr-json"] as const) {
        const { data: files } = await admin.storage.from(bucket).list(user.id, {
          limit: 1000,
        });
        if (files?.length) {
          const paths = files.map((f) => `${user.id}/${f.name}`);
          await admin.storage.from(bucket).remove(paths);
        }
      }
      await admin.auth.admin.deleteUser(user.id);
    } catch (err) {
      console.error(err);
      // Fallback: delete profile (cascades) and sign out — auth user may remain if no service key
      const { error } = await supabase.from("profiles").delete().eq("id", user.id);
      if (error) return fail(error.message, 400);
      await supabase.auth.signOut();
      return ok({ deleted: true, authPurged: false });
    }

    return ok({ deleted: true, authPurged: true });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
