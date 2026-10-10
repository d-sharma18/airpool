"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button, ErrorNote, Input, Label, Spinner, cx } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm() {
  const supabase = createClient();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next")?.startsWith("/") ? params.get("next")! : "/dashboard";

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(params.get("error") ?? "");
  const [notice, setNotice] = useState("");

  const callback = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function google() {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: callback() } });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const { data, error } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: callback() } });
    setBusy(false);
    if (error) return setError(error.message);
    if (mode === "signup" && !data.session) {
      return setNotice("Check your inbox to confirm your email, then sign in.");
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="grid gap-5">
      <Button variant="ghost" full onClick={google} disabled={busy}>
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
          <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.2 14.6 2.2 12 2.2 6.6 2.2 2.2 6.6 2.2 12s4.4 9.8 9.8 9.8c5.7 0 9.4-4 9.4-9.6 0-.6-.1-1.1-.2-1.6H12z" />
        </svg>
        Continue with Google
      </Button>

      <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-muted">
        <span className="h-px flex-1 bg-line" /> or email <span className="h-px flex-1 bg-line" />
      </div>

      <div className="grid grid-cols-2 rounded-xl bg-surface-2 p-1 text-sm">
        {(["signin", "signup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cx("h-10 rounded-lg font-medium", mode === m ? "bg-line text-ink" : "text-muted")}
          >
            {m === "signin" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="grid gap-4">
        <label>
          <Label>Email</Label>
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          <Label hint={mode === "signup" ? "At least 8 characters" : undefined}>Password</Label>
          <Input
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <ErrorNote>{error}</ErrorNote>
        {notice && <p className="rounded-xl bg-ok/10 px-3 py-2 text-sm text-ok">{notice}</p>}
        <Button type="submit" full disabled={busy}>
          {busy && <Spinner />}
          {mode === "signin" ? "Sign in" : "Create account"}
        </Button>
      </form>
    </div>
  );
}
