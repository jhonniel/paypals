"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function SignupInviteLanding({ code }: { code: string }) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "valid"; label: string | null }
    | { status: "invalid"; message: string }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/auth/invite?code=${encodeURIComponent(code)}`)
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (res.ok && json?.data?.valid) {
          setState({
            status: "valid",
            label: json.data.label ?? null,
          });
          return;
        }
        setState({
          status: "invalid",
          message:
            json?.error?.message ??
            "This invite link is invalid or already used.",
        });
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            status: "invalid",
            message: "Could not check this invite. Try again.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const signupHref = `/signup?invite=${encodeURIComponent(code)}`;

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-xl">You&apos;re invited to Paypals</CardTitle>
        <CardDescription>
          This link is unique and works once. Create your account to start
          splitting receipts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.status === "loading" ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking invite…
          </p>
        ) : null}

        {state.status === "valid" ? (
          <>
            <div className="flex items-start gap-2 rounded-xl border border-primary/25 bg-accent/40 px-3 py-2.5 text-sm">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <p className="font-medium text-foreground">Invite accepted</p>
                <p className="text-muted-foreground">
                  {state.label || "One-time signup invite"}
                </p>
              </div>
            </div>
            <Button asChild className="w-full">
              <Link href={signupHref}>Continue to sign up</Link>
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </>
        ) : null}

        {state.status === "invalid" ? (
          <>
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="text-muted-foreground">{state.message}</p>
            </div>
            <Button asChild variant="outline" className="w-full">
              <Link href="/signup">Go to signup</Link>
            </Button>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
