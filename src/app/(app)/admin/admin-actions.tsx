"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/toaster";
import { Spinner, cx } from "@/components/ui";

export default function AdminActions({
  reportId,
  userId,
  blocked,
  womenOnlyBlocked,
  open,
}: {
  reportId?: number;
  userId: string;
  blocked: boolean;
  womenOnlyBlocked: boolean;
  open: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState("");

  async function act(action: string, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(action);
    const res = await fetch("/api/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, userId, reportId }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy("");
    if (!res?.ok) return toast(body.error ?? "That didn't work", "error");
    toast("Done", "success");
    router.refresh();
  }

  const btn = (tone: "danger" | "plain") =>
    cx(
      "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm",
      tone === "danger" ? "border-danger/50 text-danger" : "border-line text-ink",
    );

  return (
    <div className="flex flex-wrap gap-2">
      {blocked ? (
        <button className={btn("plain")} onClick={() => act("unblock", "Unblock this user? They'll be able to sign in again.")} disabled={!!busy}>
          {busy === "unblock" && <Spinner />} Unblock
        </button>
      ) : (
        <button className={btn("danger")} onClick={() => act("block", "Block this user? They'll be signed out and can't use Airpool.")} disabled={!!busy}>
          {busy === "block" && <Spinner />} Block user
        </button>
      )}
      {open && reportId && (
        <>
          <button className={btn("plain")} onClick={() => act("actioned")} disabled={!!busy}>
            {busy === "actioned" && <Spinner />} Mark handled
          </button>
          <button className={btn("plain")} onClick={() => act("dismiss")} disabled={!!busy}>
            {busy === "dismiss" && <Spinner />} Dismiss
          </button>
        </>
      )}
      {womenOnlyBlocked && (
        <button
          className={btn("plain")}
          onClick={() => act("restore_women_only", "Restore women-only access? Only do this if the report was false.")}
          disabled={!!busy}
        >
          {busy === "restore_women_only" && <Spinner />} Restore women-only
        </button>
      )}
    </div>
  );
}
