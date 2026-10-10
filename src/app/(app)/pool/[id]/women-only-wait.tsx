"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toaster";
import { Button, Card, Spinner } from "@/components/ui";
import { MATCH_RULES } from "@/config/matching";
import { createClient } from "@/lib/supabase/client";

type Choice = "wait" | "notify" | "open";

/**
 * Shown to the host of a women-only group who is still alone after 15 minutes.
 * Also fires a browser notification when a woman joins, if she asked to be notified.
 */
export default function WomenOnlyWait({
  poolId,
  createdAt,
  waitUntil,
  alone,
  notify,
  memberCount,
  onChanged,
}: {
  poolId: string;
  createdAt: string;
  waitUntil: string | null;
  alone: boolean;
  notify: boolean;
  memberCount: number;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<Choice | null>(null);
  const seen = useRef(memberCount);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (notify && memberCount > seen.current) {
      toast("A verified woman joined your group", "success");
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("Airpool", { body: "A verified woman joined your women-only group." });
      }
    }
    seen.current = memberCount;
  }, [memberCount, notify, toast]);

  // 'infinity' (from the "notify me" choice) parses to NaN, which never counts as due.
  const due =
    alone &&
    now - new Date(createdAt).getTime() >= MATCH_RULES.WOMEN_ONLY_WAIT_MIN * 60_000 &&
    (!waitUntil || now >= new Date(waitUntil).getTime());

  if (alone && notify) {
    return (
      <Card className="border-women/30 bg-women/5 text-sm">
        <span className="font-medium text-women">We&apos;ll let you know</span>{" "}
        <span className="text-muted">when a verified woman joins. Keep Airpool open in a tab to get the alert.</span>
      </Card>
    );
  }
  if (!due) return null;

  async function choose(choice: Choice) {
    setBusy(choice);
    if (choice === "notify" && "Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission().catch(() => {});
    }
    const { error } = await createClient().rpc("women_pool_choice", { p_pool: poolId, p_choice: choice });
    setBusy(null);
    if (error) return toast(error.message, "error");
    toast(
      choice === "wait"
        ? `We'll check again in ${MATCH_RULES.WOMEN_ONLY_WAIT_MIN} minutes`
        : choice === "notify"
          ? "We'll notify you when a woman joins"
          : "Your group is now open to all verified riders",
      "success",
    );
    onChanged();
  }

  return (
    <Card className="grid grid-cols-1 gap-3 border-women/40 bg-women/5">
      <div>
        <p className="font-semibold text-women">No woman has joined yet</p>
        <p className="mt-1 text-sm text-muted">
          It&apos;s been over {MATCH_RULES.WOMEN_ONLY_WAIT_MIN} minutes. What would you like to do?
        </p>
      </div>
      <Button variant="ghost" full onClick={() => choose("wait")} disabled={!!busy}>
        {busy === "wait" && <Spinner />} Keep waiting
      </Button>
      <Button variant="ghost" full onClick={() => choose("notify")} disabled={!!busy}>
        {busy === "notify" && <Spinner />} Notify me when a woman joins
      </Button>
      <Button variant="outline" full onClick={() => choose("open")} disabled={!!busy}>
        {busy === "open" && <Spinner />} Open to everyone
      </Button>
      <p className="text-xs text-muted">Opening up lets any verified rider join. You can&apos;t undo it once someone joins.</p>
    </Card>
  );
}
