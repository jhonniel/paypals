"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signupSchema, type SignupValues } from "@/features/auth/schemas";
import { GoogleButton } from "@/features/auth/google-button";
import { safeRedirectPath } from "@/lib/security";

export function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeRedirectPath(searchParams.get("next"), "/dashboard");
  const presetInvite =
    searchParams.get("invite")?.trim() ||
    searchParams.get("code")?.trim() ||
    "";

  const [inviteLabel, setInviteLabel] = useState<string | null>(null);
  const [checkingInvite, setCheckingInvite] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      inviteCode: presetInvite,
      fullName: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const inviteCode = watch("inviteCode");

  useEffect(() => {
    if (presetInvite) setValue("inviteCode", presetInvite);
  }, [presetInvite, setValue]);

  useEffect(() => {
    const code = inviteCode?.trim() ?? "";
    if (code.length < 4) {
      setInviteLabel(null);
      return;
    }
    const t = setTimeout(() => {
      setCheckingInvite(true);
      void fetch(`/api/auth/invite?code=${encodeURIComponent(code)}`)
        .then(async (res) => {
          const json = await res.json();
          if (res.ok && json?.data?.valid) {
            setInviteLabel(
              json.data.kind === "group"
                ? `Group: ${json.data.label}`
                : json.data.label || "Invite accepted"
            );
          } else {
            setInviteLabel(null);
          }
        })
        .catch(() => setInviteLabel(null))
        .finally(() => setCheckingInvite(false));
    }, 350);
    return () => clearTimeout(t);
  }, [inviteCode]);

  async function onSubmit(values: SignupValues) {
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: values.email,
          password: values.password,
          fullName: values.fullName,
          inviteCode: values.inviteCode.trim(),
        }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(json?.error?.message ?? "Signup failed");
        return;
      }

      if (json?.data?.needsConfirmation) {
        toast.success("Check your email to confirm your account");
        router.push(`/login?next=${encodeURIComponent(json.data.redirectTo ?? next)}`);
        return;
      }

      toast.success("Account created");
      router.push(json?.data?.redirectTo ?? next);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error");
    }
  }

  const googleNext = next;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        Paypals is invite-only. Enter a valid invite code to create your account and unlock
        full access.
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="inviteCode">Invite code</Label>
          <Input
            id="inviteCode"
            autoComplete="off"
            placeholder="e.g. PAYPALS or a group invite"
            {...register("inviteCode")}
          />
          {checkingInvite && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Checking invite…
            </p>
          )}
          {inviteLabel && !checkingInvite && (
            <p className="flex items-center gap-1.5 text-xs text-primary">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {inviteLabel}
            </p>
          )}
          {errors.inviteCode && (
            <p className="text-xs text-destructive">{errors.inviteCode.message}</p>
          )}
        </div>

        <div className="relative py-1">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs uppercase tracking-wider">
            <span className="bg-card px-3 text-muted-foreground">then continue</span>
          </div>
        </div>

        <GoogleButton
          next={googleNext}
          inviteCode={inviteCode?.trim() || undefined}
          label="Sign up with Google"
          disabled={!inviteLabel}
        />

        <div className="space-y-2">
          <Label htmlFor="fullName">Full name</Label>
          <Input id="fullName" autoComplete="name" {...register("fullName")} />
          {errors.fullName && (
            <p className="text-xs text-destructive">{errors.fullName.message}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" {...register("email")} />
          {errors.email && (
            <p className="text-xs text-destructive">{errors.email.message}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            {...register("password")}
          />
          {errors.password && (
            <p className="text-xs text-destructive">{errors.password.message}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            {...register("confirmPassword")}
          />
          {errors.confirmPassword && (
            <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
          )}
        </div>
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="animate-spin" />}
          Create account
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
