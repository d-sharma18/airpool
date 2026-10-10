"use client";

import { useState } from "react";
import { useToast } from "@/components/toaster";
import { Button, Card, Spinner, cx } from "@/components/ui";
import { REPORT_REASONS } from "@/lib/reports";
import { createClient } from "@/lib/supabase/client";


/**
 * After a women-only ride: "was everyone a woman?". On any locked/finished ride: report a rider.
 * A report on a women-only ride removes that person's women-only access and flags them for review.
 */
export default function RideFeedback({
  poolId,
  womenOnly,
  completed,
  confirmed,
  riders,
  onDone,
}: {
  poolId: string;
  womenOnly: boolean;
  completed: boolean;
  /** My earlier answer to "was everyone a woman?", if any. */
  confirmed: boolean | null;
  /** Other riders I could report. */
  riders: { id: string; name: string }[];
  onDone: () => void;
}) {
  const toast = useToast();
  const supabase = createClient();
  const [reporting, setReporting] = useState(false);
  const [who, setWho] = useState(riders.length === 1 ? riders[0].id : "");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const askWomen = womenOnly && completed && confirmed === null;

  async function confirmAllWomen(yes: boolean) {
    setBusy(true);
    const { error } = await supabase.rpc("confirm_ride", { p_pool: poolId, p_all_women: yes });
    setBusy(false);
    if (error) return toast(error.message, "error");
    if (yes) {
      toast("Thanks for confirming", "success");
      onDone();
    } else {
      setReason("not_a_woman");
      setReporting(true);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!who || !reason) return toast("Pick who and why", "error");
    setBusy(true);
    const { error } = await supabase.rpc("report_rider", { p_pool: poolId, p_reported: who, p_reason: reason, p_note: note });
    setBusy(false);
    if (error) return toast(error.message, "error");
    toast(
      womenOnly
        ? "Reported. They can no longer join women-only rides, and our team will review it."
        : "Reported. Our team will review it.",
      "success",
    );
    setReporting(false);
    setNote("");
    onDone();
  }

  return (
    <Card className="grid grid-cols-1 gap-3">
      {askWomen && !reporting && (
        <div className="grid gap-3 rounded-xl border border-women/40 bg-women/5 p-3">
          <p className="font-semibold text-women">Was everyone in your cab a woman?</p>
          <p className="text-sm text-muted">This keeps women-only rides safe. Your answer is private.</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="ghost" onClick={() => confirmAllWomen(true)} disabled={busy}>
              Yes, all women
            </Button>
            <Button variant="outline" onClick={() => confirmAllWomen(false)} disabled={busy}>
              No
            </Button>
          </div>
        </div>
      )}
      {womenOnly && completed && confirmed !== null && !reporting && (
        <p className="text-sm text-muted">{confirmed ? "✓ You confirmed this was a women-only ride." : "Thanks. Your report is with our team."}</p>
      )}

      {!reporting ? (
        <button className="justify-self-start text-sm text-muted underline" onClick={() => setReporting(true)}>
          Report a rider
        </button>
      ) : (
        <form onSubmit={submit} className="grid grid-cols-1 gap-3">
          <p className="font-semibold">Report a rider</p>
          {riders.length > 1 && (
            <div className="grid gap-1.5">
              <p className="text-sm text-muted">Who?</p>
              <div className="flex flex-wrap gap-2">
                {riders.map((r) => (
                  <button
                    type="button"
                    key={r.id}
                    onClick={() => setWho(r.id)}
                    className={cx("rounded-full border px-3 py-1.5 text-sm", who === r.id ? "border-accent bg-accent/10 text-accent" : "border-line")}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="grid gap-1.5">
            <p className="text-sm text-muted">What happened?</p>
            {REPORT_REASONS.filter((r) => !("womenOnly" in r) || womenOnly).map((r) => (
              <label key={r.value} className="flex items-center gap-2 text-sm">
                <input type="radio" name="reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} className="accent-[#f5b83d]" />
                {r.label}
              </label>
            ))}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Anything else we should know (optional)"
            className="w-full rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-ink outline-none focus:border-accent"
          />
          {womenOnly && (
            <p className="text-xs text-muted">
              On a women-only ride, a report removes that person&apos;s women-only access for good and flags them for review.
            </p>
          )}
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Button type="submit" variant="danger" disabled={busy || !who || !reason}>
              {busy && <Spinner />} Send report
            </Button>
            <Button type="button" variant="ghost" onClick={() => setReporting(false)}>
              Cancel
            </Button>
          </div>
          <p className="text-xs text-muted">In danger right now? Use SOS or call 112.</p>
        </form>
      )}
    </Card>
  );
}
