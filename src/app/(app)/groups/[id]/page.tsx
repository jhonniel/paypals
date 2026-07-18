import { GroupDetailView } from "@/features/groups/group-detail";

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <GroupDetailView groupId={id} />;
}
