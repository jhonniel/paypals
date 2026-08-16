import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PalOwesMePageView } from "@/features/pal-owes-me/pal-owes-me-page";

export default async function PalOwesMePage({
  searchParams,
}: {
  searchParams: Promise<{ perspective?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const initialPerspective = params.perspective === "debtor" ? "debtor" : "creditor";

  return (
    <PalOwesMePageView
      currentUserId={user.id}
      initialPerspective={initialPerspective}
    />
  );
}
