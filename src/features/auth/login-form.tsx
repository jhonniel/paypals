"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
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

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  google_not_registered: "Your email is not yet registered.",
  invite_required: "A valid invite code is required to create an account.",
  auth_callback: "Sign-in failed. Please try again.",
};

function readAuthErrorCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith("paypals_auth_error="));
  if (!match) return null;
  return decodeURIComponent(match.split("=").slice(1).join("=") || "");
}

function clearAuthErrorCookie() {
  if (typeof document === "undefined") return;
  document.cookie = "paypals_auth_error=; Path=/; Max-Age=0; SameSite=Lax";
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeRedirectPath(searchParams.get("next"), "/dashboard");
  const authError = searchParams.get("error");
  const [formError, setFormError] = useState<string | null>(null);

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
    const code = authError || readAuthErrorCookie();
    if (!code) return;
    const message = AUTH_ERROR_MESSAGES[code] ?? decodeURIComponent(code);
    setFormError(message);
    toast.error(message);
    clearAuthErrorCookie();
  }, [authError]);

  async function onSubmit(values: LoginValues) {
    setFormError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        setFormError(json?.error?.message ?? `Login failed (${res.status})`);
        return;
      }

      toast.success("Welcome back");
      router.push(next);
      router.refresh();
    } catch {
      setFormError("Network error. Please try again.");
    }
  }

  const notRegistered = formError === "Your email is not yet registered.";

  return (
    <div className="space-y-6">
      {formError && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
        >
          <p className="font-medium">{formError}</p>
          {notRegistered && (
            <p className="mt-1 text-xs text-destructive/90">
              Create an account with an invite code first.{" "}
              <Link
                href="/signup"
                className="font-medium underline underline-offset-2"
              >
                Sign up
              </Link>
            </p>
          )}
        </div>
      )}

      <GoogleButton next={next} label="Sign in with Google" mode="login" />
      <p className="-mt-3 text-center text-xs text-muted-foreground">
        New here?{" "}
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
