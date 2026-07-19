"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginSchema, type LoginValues } from "@/features/auth/schemas";
import { GoogleButton } from "@/features/auth/google-button";
import { safeRedirectPath } from "@/lib/security";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeRedirectPath(searchParams.get("next"), "/dashboard");
  const authError = searchParams.get("error");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  useEffect(() => {
    if (!authError) return;
    const messages: Record<string, string> = {
      google_not_registered:
        "Google sign-in is only for existing accounts. Sign up with an invite code first.",
      invite_required: "A valid invite code is required.",
      auth_callback: "Google sign-in failed. Please try again.",
    };
    toast.error(messages[authError] ?? decodeURIComponent(authError));
  }, [authError]);

  async function onSubmit(values: LoginValues) {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(json?.error?.message ?? `Login failed (${res.status})`);
        return;
      }

      toast.success("Welcome back");
      router.push(next);
      router.refresh();
    } catch {
      toast.error("Network error. Please try again.");
    }
  }

  return (
    <div className="space-y-6">
      <GoogleButton next={next} label="Sign in with Google" mode="login" />
      <p className="-mt-3 text-center text-xs text-muted-foreground">
        Only for accounts already created with an invite. New here?{" "}
        <Link href="/signup" className="text-primary hover:underline">
          Sign up with an invite code
        </Link>
      </p>
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase tracking-wider">
          <span className="bg-card px-3 text-muted-foreground">or continue with email</span>
        </div>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" {...register("email")} />
          {errors.email && (
            <p className="text-xs text-destructive">{errors.email.message}</p>
          )}
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              href="/forgot-password"
              className="text-xs text-muted-foreground hover:text-primary"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            {...register("password")}
          />
          {errors.password && (
            <p className="text-xs text-destructive">{errors.password.message}</p>
          )}
        </div>
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="animate-spin" />}
          Sign in
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        Prefer a passwordless login?{" "}
        <Link href="/magic-link" className="text-primary hover:underline">
          Magic link
        </Link>
      </p>
      <p className="text-center text-sm text-muted-foreground">
        New to Paypals?{" "}
        <Link href="/signup" className="text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
