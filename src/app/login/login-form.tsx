"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { GoogleButton, OrDivider } from "@/components/google-button";
import { useToast } from "@/components/toaster";
import { Button, ErrorNote, Field, Input, Spinner } from "@/components/ui";
import { describeAuthError, type AuthErrorKind } from "@/lib/auth-errors";
import { createClient } from "@/lib/supabase/client";
import { safeNext, validateEmail } from "@/lib/validation";

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const next = safeNext(params.get("next"));

  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string | null; password?: string | null }>({});
  const [error, setError] = useState<{ kind: AuthErrorKind; message: string } | null>(
    params.get("error") ? { kind: "other", message: params.get("error")! } : null,
  );
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs = { email: validateEmail(email), password: password ? null : "Enter your password." };
    setFieldErrors(errs);
    if (errs.email || errs.password) return;

    setBusy(true);
    setError(null);
    setResent(false);
    const { error } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) return setError(describeAuthError(error));
    router.replace(next);
    router.refresh();
  }

  async function resend() {
    const { error } = await createClient().auth.resend({
      type: "signup",
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) return toast(describeAuthError(error).message, "error");
    setResent(true);
    toast("Verification email sent", "success");
  }

  return (
    <div className="grid gap-5">
      <GoogleButton next={next} />
      <OrDivider />

      <form onSubmit={submit} noValidate className="grid gap-4">
        <Field id="email" label="Email" error={fieldErrors.email}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            invalid={!!fieldErrors.email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field id="password" label="Password" error={fieldErrors.password}>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            invalid={!!fieldErrors.password || error?.kind === "wrong_password"}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        {error && (
          <div className="grid gap-2">
            <ErrorNote>{error.message}</ErrorNote>
            {error.kind === "unverified_email" && (
              <Button type="button" variant="ghost" full onClick={resend} disabled={resent}>
                {resent ? "Email sent. Check your inbox" : "Resend verification email"}
              </Button>
            )}
          </div>
        )}

        <Button type="submit" full disabled={busy}>
          {busy && <Spinner />} Log in
        </Button>
      </form>

      <p className="text-center text-sm text-muted">
        New to Airpool?{" "}
        <Link href={`/signup${next !== "/dashboard" ? `?next=${encodeURIComponent(next)}` : ""}`} className="text-accent underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
