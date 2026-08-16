import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AnnouncementPageView } from "@/features/announcements/announcement-page-view";

export default async function AnnouncementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { id } = await params;
  return <AnnouncementPageView id={id} />;
}
