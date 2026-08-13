import type { SupabaseClient } from "@supabase/supabase-js";

const STORAGE_BUCKETS = [
  "avatars",
  "receipts",
  "ocr-json",
  "payment-qr",
  "payment-proofs",
] as const;

async function deletePaymentsForMemberIds(
  admin: SupabaseClient,
  memberIds: string[]
) {
  if (!memberIds.length) return;
  const idList = memberIds.join(",");
  await admin
    .from("payments")
    .delete()
    .or(`from_member_id.in.(${idList}),to_member_id.in.(${idList})`);
}

async function deleteReceiptStorage(
  admin: SupabaseClient,
  userId: string,
  receiptId: string,
  storagePaths: string[]
) {
  const paths = storagePaths.filter(Boolean);
  if (paths.length) {
    await admin.storage.from("receipts").remove(paths);
  }
  await admin.storage
    .from("ocr-json")
    .remove([`${userId}/${receiptId}/ocr.json`])
    .catch(() => undefined);
}

async function purgeUserStorage(admin: SupabaseClient, userId: string) {
  for (const bucket of STORAGE_BUCKETS) {
    const { data: files } = await admin.storage.from(bucket).list(userId, {
      limit: 1000,
    });
    if (!files?.length) continue;
    const paths = files.map((f) => `${userId}/${f.name}`);
    await admin.storage.from(bucket).remove(paths);
  }
}

export async function adminDeleteUser(
  admin: SupabaseClient,
  userId: string
): Promise<{ error?: string }> {
  const { data: profile } = await admin
    .from("profiles")
    .select("id, is_admin")
    .eq("id", userId)
    .maybeSingle();

  if (!profile) return { error: "User not found" };

  const { data: userMembers } = await admin
    .from("group_members")
    .select("id")
    .eq("user_id", userId);
  const userMemberIds = (userMembers ?? []).map((m) => m.id);
  await deletePaymentsForMemberIds(admin, userMemberIds);

  const { data: ownedGroups } = await admin
    .from("groups")
    .select("id")
    .eq("created_by", userId);

  for (const group of ownedGroups ?? []) {
    const { data: groupMembers } = await admin
      .from("group_members")
      .select("id")
      .eq("group_id", group.id);
    await deletePaymentsForMemberIds(
      admin,
      (groupMembers ?? []).map((m) => m.id)
    );
  }

  if (ownedGroups?.length) {
    const ownedGroupIds = ownedGroups.map((g) => g.id);
    const { error: groupsError } = await admin
      .from("groups")
      .delete()
      .in("id", ownedGroupIds);
    if (groupsError) return { error: groupsError.message };
  }

  const { data: receipts } = await admin
    .from("receipts")
    .select("id")
    .eq("created_by", userId);

  for (const receipt of receipts ?? []) {
    const { data: images } = await admin
      .from("receipt_images")
      .select("storage_path")
      .eq("receipt_id", receipt.id);
    await deleteReceiptStorage(
      admin,
      userId,
      receipt.id,
      (images ?? []).map((i) => i.storage_path)
    );
  }

  const { error: receiptsError } = await admin
    .from("receipts")
    .delete()
    .eq("created_by", userId);
  if (receiptsError) return { error: receiptsError.message };

  await admin.from("group_members").delete().eq("user_id", userId);

  await purgeUserStorage(admin, userId);

  const { error: authError } = await admin.auth.admin.deleteUser(userId);
  if (authError) return { error: authError.message };

  return {};
}

export async function countAdmins(admin: SupabaseClient): Promise<number> {
  const { count } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("is_admin", true);
  return count ?? 0;
}
