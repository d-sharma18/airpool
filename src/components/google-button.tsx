"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "./toaster";
import { Button, Spinner } from "./ui";

export function GoogleButton({ next = "/dashboard" }: { next?: string }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function go() {
    setBusy(true);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) {
      toast(error.message, "error");
      setBusy(false);
    }
  }

  return (
    <Button variant="ghost" full onClick={go} disabled={busy}>
      {busy ? (
        <Spinner />
      ) : (
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
          <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.2 14.6 2.2 12 2.2 6.6 2.2 2.2 6.6 2.2 12s4.4 9.8 9.8 9.8c5.7 0 9.4-4 9.4-9.6 0-.6-.1-1.1-.2-1.6H12z" />
        </svg>
      )}
      Continue with Google
    </Button>
  );
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-muted">
      <span className="h-px flex-1 bg-line" /> or email <span className="h-px flex-1 bg-line" />
    </div>
  );
}
