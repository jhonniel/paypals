import { z } from "zod";
import { getAdminClient, getAuthedClient, writeAuditLog } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, unauthorized, forbidden, serverError, fail, fromZod } from "@/lib/api";
import { moneyNumber } from "@/lib/money";

export async function GET() {
  try {
    const auth = await getAdminClient();
    if (!auth) {
      const base = await getAuthedClient();
      if (!base) return unauthorized();
      return forbidden("Admin access required");
    }
    const { supabase } = auth;

    // Prefer service role so spend totals cover every receipt, not only what RLS exposes.
    const reader = process.env.SUPABASE_SERVICE_ROLE_KEY
      ? createAdminClient()
      : supabase;

    const [
      usersCount,
      receiptsCount,
      groupsCount,
      ocrRecent,
      flags,
      audits,
      receiptsRecent,
      usersRecent,
      allReceiptTotals,
    ] = await Promise.all([
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("receipts").select("id", { count: "exact", head: true }),
      supabase.from("groups").select("id", { count: "exact", head: true }),
      supabase
        .from("ocr_logs")
        .select("id, provider, status, confidence, duration_ms, error_message, created_at, receipt_id")
        .order("created_at", { ascending: false })
        .limit(30),
      supabase.from("feature_flags").select("*").order("key"),
      supabase
        .from("audit_logs")
        .select("id, actor_id, action, entity_type, entity_id, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(40),
      supabase
        .from("receipts")
        .select("id, merchant, total, status, currency, created_at, created_by, ocr_confidence")
        .order("created_at", { ascending: false })
        .limit(25),
      supabase
        .from("profiles")
        .select("id, email, full_name, username, is_admin, created_at")
        .order("created_at", { ascending: false })
        .limit(40),
      reader.from("receipts").select("created_by, total, currency"),
    ]);

    const { data: ocrSample } = await supabase
      .from("ocr_logs")
      .select("status")
      .order("created_at", { ascending: false })
      .limit(100);

    const ocrTotal = ocrSample?.length ?? 0;
    const ocrOk = (ocrSample ?? []).filter(
      (o) => o.status === "success" || o.status === "ok"
    ).length;

    const hasServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

    const spendByUser = new Map<string, { total: number; receiptCount: number }>();
    let totalSpend = 0;
    for (const r of allReceiptTotals.data ?? []) {
      const amount = moneyNumber(Number(r.total ?? 0));
      totalSpend = moneyNumber(totalSpend + amount);
      if (!r.created_by) continue;
      const cur = spendByUser.get(r.created_by) ?? { total: 0, receiptCount: 0 };
      cur.total = moneyNumber(cur.total + amount);
      cur.receiptCount += 1;
      spendByUser.set(r.created_by, cur);
    }

    const users = (usersRecent.data ?? []).map((u) => {
      const spend = spendByUser.get(u.id);
      return {
        ...u,
        totalSpent: spend?.total ?? 0,
        receiptCount: spend?.receiptCount ?? 0,
      };
    });

    return ok({
      health: {
        database: true,
        serviceRole: hasServiceRole,
        ocrConfigured: Boolean(
          process.env.OCR_SPACE_API_KEY ||
            process.env.GOOGLE_VISION_API_KEY ||
            process.env.OPENAI_API_KEY
        ),
        ocrSuccessRate: ocrTotal ? Math.round((ocrOk / ocrTotal) * 100) : null,
        appUrl: process.env.NEXT_PUBLIC_APP_URL ?? null,
      },
      counts: {
        users: usersCount.count ?? 0,
        receipts: receiptsCount.count ?? 0,
        groups: groupsCount.count ?? 0,
        totalSpend,
        currency: "PHP",
      },
      users,
      receipts: receiptsRecent.data ?? [],
      ocrLogs: ocrRecent.data ?? [],
      featureFlags: flags.data ?? [],
      auditLogs: audits.data ?? [],
    });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}

const patchUserSchema = z.object({
  userId: z.string().uuid(),
  is_admin: z.boolean(),
});

export async function PATCH(request: Request) {
  try {
    const auth = await getAdminClient();
    if (!auth) return forbidden("Admin access required");
    const { supabase, user } = auth;

    const body = await request.json();
    const parsed = patchUserSchema.safeParse(body);
    if (!parsed.success) return fromZod(parsed.error);

    if (parsed.data.userId === user.id && parsed.data.is_admin === false) {
      return fail("You cannot remove your own admin role", 400);
    }

    // Prefer service role so RLS cannot silently block granting admin on others.
    // Falls back to the caller client after migration 021 (profiles_update_admins).
    const writer = process.env.SUPABASE_SERVICE_ROLE_KEY
      ? createAdminClient()
      : supabase;

    const { data: updated, error } = await writer
      .from("profiles")
      .update({ is_admin: parsed.data.is_admin })
      .eq("id", parsed.data.userId)
      .select("id, is_admin")
      .maybeSingle();

    if (error) return fail(error.message, 400);
    if (!updated) {
      return fail(
        "Could not update admin role (0 rows). Run migration 021_profiles_admin_update.sql or set SUPABASE_SERVICE_ROLE_KEY.",
        400
      );
    }

    await writeAuditLog(supabase, "set_admin", "profile", parsed.data.userId, {
      is_admin: parsed.data.is_admin,
    });

    return ok({ updated: true, is_admin: updated.is_admin });
  } catch (e) {
    console.error(e);
    return serverError();
  }
}
