import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FriendsPageView } from "@/features/friends/friends-page";

export default async function FriendsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <FriendsPageView currentUserId={user.id} />;
}
