import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import type { Profile } from "@/types/database";

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-8 text-center">
        <div className="glass max-w-md rounded-3xl p-8">
          <h1 className="text-xl font-semibold">Configure Supabase</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Copy <code className="text-primary">.env.example</code> to{" "}
            <code className="text-primary">.env.local</code> and add your project
            credentials to use the app.
          </p>
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  let user = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      console.warn("[app-layout] getUser:", error.message);
    } else {
      user = data.user;
    }
  } catch (e) {
    console.warn("[app-layout] getUser threw", e);
  }

  if (!user) {
    redirect("/login");
  }

  const authed = user;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", authed.id)
    .maybeSingle();

  const fallback: Profile = {
    id: authed.id,
    email: authed.email ?? null,
    full_name: (authed.user_metadata?.full_name as string) ?? null,
    username: null,
    avatar_url: (authed.user_metadata?.avatar_url as string) ?? null,
    bio: null,
    is_admin: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return (
    <AppShell profile={(profile as Profile | null) ?? fallback}>{children}</AppShell>
  );
}
