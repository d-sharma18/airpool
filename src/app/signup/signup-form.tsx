"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { GoogleButton, OrDivider } from "@/components/google-button";
import { useToast } from "@/components/toaster";
import { Button, Card, ErrorNote, Field, Input, Spinner } from "@/components/ui";
import { describeAuthError, type AuthErrorKind } from "@/lib/auth-errors";
import { createClient } from "@/lib/supabase/client";
import {
  normalizePhone,
  safeNext,
  validateEmail,
  validateFullName,
  validatePassword,
  validatePhone,
  validateUpi,
} from "@/lib/validation";

type Fields = "fullName" | "email" | "password" | "phone" | "upi";

export default function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const next = safeNext(params.get("next"));

  const [v, setV] = useState<Record<Fields, string>>({ fullName: "", email: "", password: "", phone: "", upi: "" });
  const [errs, setErrs] = useState<Partial<Record<Fields, string | null>>>({});
  const [error, setError] = useState<{ kind: AuthErrorKind; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState("");

  const set = (k: Fields) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setV((s) => ({ ...s, [k]: e.target.value }));
    if (errs[k]) setErrs((s) => ({ ...s, [k]: null }));
  };

  const check = (k: Fields) => {
    const fn = { fullName: validateFullName, email: validateEmail, password: validatePassword, phone: validatePhone, upi: validateUpi }[k];
    setErrs((s) => ({ ...s, [k]: fn(v[k]) }));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const found = {
      fullName: validateFullName(v.fullName),
      email: validateEmail(v.email),
      password: validatePassword(v.password),
      phone: validatePhone(v.phone),
      upi: validateUpi(v.upi),
    };
    setErrs(found);
    if (Object.values(found).some(Boolean)) return;

    setBusy(true);
    setError(null);
    const email = v.email.trim();
    const { data, error } = await createClient().auth.signUp({
      email,
      password: v.password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        // Copied into public.profiles by the on_auth_user_created trigger.
        data: { full_name: v.fullName.trim(), phone: normalizePhone(v.phone), upi_id: v.upi.trim() },
      },
    });
    setBusy(false);

    if (error) return setError(describeAuthError(error));
    // With email confirmation on, Supabase hides duplicates by returning a user with no identities.
    if (data.user && data.user.identities?.length === 0) {
      return setError({ kind: "existing_email", message: "An account with this email already exists. Log in instead." });
    }
    if (!data.session) return setSentTo(email);

    toast("Account created", "success");
    router.replace(next);
    router.refresh();
  }

  async function resend() {
    const { error } = await createClient().auth.resend({
      type: "signup",
      email: sentTo,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    toast(error ? describeAuthError(error).message : "Verification email sent again", error ? "error" : "success");
  }

  if (sentTo) {
    return (
      <Card className="grid gap-4">
        <p className="text-lg font-semibold">Verify your email</p>
        <p className="text-sm text-muted">
          We sent a link to <span className="text-ink">{sentTo}</span>. Open it on this device to finish creating your
          account. Check spam if you don&apos;t see it.
        </p>
        <Button variant="ghost" full onClick={resend}>
          Resend email
        </Button>
        <Link href={`/login?email=${encodeURIComponent(sentTo)}`} className="text-center text-sm text-accent underline">
          Back to log in
        </Link>
      </Card>
    );
  }

  return (
    <div className="grid gap-5">
      <GoogleButton next={next} />
      <OrDivider />

      <form onSubmit={submit} noValidate className="grid gap-4">
        <Field id="fullName" label="Full name" hint="As on your Aadhaar" error={errs.fullName}>
          <Input id="fullName" autoComplete="name" value={v.fullName} invalid={!!errs.fullName} onChange={set("fullName")} onBlur={() => v.fullName && check("fullName")} />
        </Field>

        <Field id="email" label="Email" error={errs.email}>
          <Input id="email" type="email" inputMode="email" autoComplete="email" value={v.email} invalid={!!errs.email} onChange={set("email")} onBlur={() => v.email && check("email")} />
        </Field>

        <Field id="password" label="Password" hint="8+ characters, with a number" error={errs.password}>
          <Input id="password" type="password" autoComplete="new-password" value={v.password} invalid={!!errs.password} onChange={set("password")} onBlur={() => v.password && check("password")} />
        </Field>

        <Field id="phone" label="Mobile number" error={errs.phone}>
          <div className="flex gap-2">
            <span className="grid h-12 place-items-center rounded-xl border border-line bg-surface-2 px-3 font-mono text-muted">+91</span>
            <Input
              id="phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder="98XXXXXXXX"
              maxLength={14}
              value={v.phone}
              invalid={!!errs.phone}
              onChange={set("phone")}
              onBlur={() => v.phone && check("phone")}
            />
          </div>
        </Field>
        <p className="-mt-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2.5 text-sm">
          <span className="font-semibold text-accent">Use the number linked to your Aadhaar.</span>{" "}
          <span className="text-muted">
            We check it against your Aadhaar during verification, so any other number will fail. Co-riders see it only after
            a group is locked.
          </span>
        </p>

        <Field id="upi" label="UPI ID" hint="Co-riders pay you here" error={errs.upi}>
          <Input id="upi" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="name@bank" value={v.upi} invalid={!!errs.upi} onChange={set("upi")} onBlur={() => v.upi && check("upi")} />
        </Field>

        {error && (
          <ErrorNote>
            {error.message}
            {error.kind === "existing_email" && (
              <>
                {" "}
                <Link href={`/login?email=${encodeURIComponent(v.email.trim())}`} className="underline">
                  Go to log in
                </Link>
              </>
            )}
          </ErrorNote>
        )}

        <Button type="submit" full disabled={busy}>
          {busy && <Spinner />} Create account
        </Button>
      </form>

      <p className="text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-accent underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
