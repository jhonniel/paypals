import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { GroupDetailView } from "@/features/groups/group-detail";

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <GroupDetailView groupId={id} currentUserId={user.id} />;
}
