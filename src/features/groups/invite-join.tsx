"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function InviteJoinView({ code }: { code: string }) {
  const router = useRouter();
  const [joining, setJoining] = useState(false);

  const { data, isLoading, error, isError } = useQuery({
    queryKey: ["invite", code],
    queryFn: async () => {
      const res = await fetch(`/api/groups/join?code=${encodeURIComponent(code)}`);
      const json = await res.json();
      if (res.status === 401) {
        const err = new Error("AUTH") as Error & { code?: string };
        err.code = "AUTH";
        throw err;
      }
      if (!res.ok) throw new Error(json?.error?.message ?? "Invalid invite");
      return json.data as {
        id: string;
        name: string;
        description: string | null;
        member_count: number;
      };
    },
    retry: false,
  });

  async function join() {
    setJoining(true);
    try {
      const res = await fetch("/api/groups/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const json = await res.json();
      if (res.status === 401) {
        router.push(`/login?next=${encodeURIComponent(`/invite/${code}`)}`);
        return;
      }
      if (!res.ok) throw new Error(json?.error?.message ?? "Join failed");
      toast.success("Joined group");
      router.push(`/groups/${json.data.group_id}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Join failed");
    } finally {
      setJoining(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (isError && (error as Error & { code?: string })?.message === "AUTH") {
    return (
      <Card className="mx-auto max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Sign in to join</CardTitle>
          <CardDescription>
            Create an account or sign in to accept this group invite.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button asChild>
            <Link href={`/login?next=${encodeURIComponent(`/invite/${code}`)}`}>
              Sign in
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/signup?invite=${encodeURIComponent(code)}`}>
              Create account
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle>Invite not found</CardTitle>
          <CardDescription>
            {error instanceof Error && error.message !== "AUTH"
              ? error.message
              : "This link may be invalid."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
          <Users className="h-5 w-5" />
        </div>
        <CardTitle>{data.name}</CardTitle>
        <CardDescription>
          {data.description || "You've been invited to split bills on Paypals."}
          {data.member_count != null ? ` · ${data.member_count} members` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button className="w-full" onClick={() => void join()} disabled={joining}>
          {joining && <Loader2 className="animate-spin" />}
          Join group
        </Button>
      </CardContent>
    </Card>
  );
}
