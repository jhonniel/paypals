"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { HandCoins, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function money(value: number, currency = "PHP") {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function PalDebtClaimView({ token }: { token: string }) {
  const router = useRouter();
  const [claiming, setClaiming] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["pal-debt-invite", token],
    queryFn: async () => {
      const res = await fetch(
        `/api/pal-debts/claim?token=${encodeURIComponent(token)}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Invalid invite");
      return json.data as {
        debtId: string;
        pendingName: string | null;
        pendingEmail: string | null;
        amount: number;
        currency: string;
        description: string | null;
        creditorName: string;
      };
    },
    retry: false,
  });

  async function claim() {
    setClaiming(true);
    try {
      const res = await fetch("/api/pal-debts/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const json = await res.json();
      if (res.status === 401) {
        router.push(`/login?next=${encodeURIComponent(`/invite/pal-debt/${token}`)}`);
        return;
      }
      if (!res.ok) throw new Error(json?.error?.message ?? "Claim failed");
      toast.success("Debt linked to your account");
      router.push("/pal-owes-me");
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

  if (error || !data) {
    return (
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle>Invite not found</CardTitle>
          <CardDescription>
            {error instanceof Error
              ? error.message
              : "This debt invite may already be claimed."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button asChild>
            <Link href={`/signup?next=${encodeURIComponent(`/invite/pal-debt/${token}`)}`}>
              Create account
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/login?next=${encodeURIComponent(`/invite/pal-debt/${token}`)}`}>
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
          <HandCoins className="h-5 w-5" />
        </div>
        <CardTitle>{data.creditorName} recorded a debt</CardTitle>
        <CardDescription>
          {data.pendingName
            ? `${data.creditorName} says ${data.pendingName} owes ${money(data.amount, data.currency)}.`
            : `You owe ${money(data.amount, data.currency)}.`}
          {data.description ? ` ${data.description}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Button className="w-full" onClick={() => void claim()} disabled={claiming}>
          {claiming && <Loader2 className="animate-spin" />}
          Claim this debt
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          No account yet?{" "}
          <Link
            className="text-primary hover:underline"
            href={`/signup?next=${encodeURIComponent(`/invite/pal-debt/${token}`)}`}
          >
            Sign up first
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
