"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function GuestClaimView({ token }: { token: string }) {
  const router = useRouter();
  const [claiming, setClaiming] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["guest-invite", token],
    queryFn: async () => {
      const res = await fetch(
        `/api/groups/claim-guest?token=${encodeURIComponent(token)}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Invalid invite");
      return json.data as {
        guestName: string | null;
        group: { id: string; name: string; description: string | null } | null;
      };
    },
    retry: false,
  });

  async function claim() {
    setClaiming(true);
    try {
      const res = await fetch("/api/groups/claim-guest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const json = await res.json();
      if (res.status === 401) {
        router.push(`/login?next=${encodeURIComponent(`/invite/guest/${token}`)}`);
        return;
      }
      if (!res.ok) throw new Error(json?.error?.message ?? "Claim failed");
      toast.success("You're in the group");
      router.push(`/groups/${json.data.group_id}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Claim failed");
    } finally {
      setClaiming(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data?.group) {
    return (
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle>Invite not found</CardTitle>
          <CardDescription>
            {error instanceof Error
              ? error.message
              : "This guest invite may already be claimed."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button asChild>
            <Link href={`/signup?next=${encodeURIComponent(`/invite/guest/${token}`)}`}>
              Create account
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/login?next=${encodeURIComponent(`/invite/guest/${token}`)}`}>
              Sign in
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
          <Users className="h-5 w-5" />
        </div>
        <CardTitle>{data.group.name}</CardTitle>
        <CardDescription>
          {data.guestName
            ? `You're invited as ${data.guestName}. Claim this seat to track what you ordered.`
            : "Claim your seat to split bills with this group."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Button className="w-full" onClick={() => void claim()} disabled={claiming}>
          {claiming && <Loader2 className="animate-spin" />}
          Join group
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          No account yet?{" "}
          <Link
            className="text-primary hover:underline"
            href={`/signup?next=${encodeURIComponent(`/invite/guest/${token}`)}`}
          >
            Sign up first
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
