"use client";

import { useState } from "react";
import { useToast } from "@/components/toaster";
import { Button, Card, Input, Spinner, cx } from "@/components/ui";
import { MEETING_POINTS } from "@/lib/share";
import { createClient } from "@/lib/supabase/client";
import type { MeetingPoint as Point } from "@/lib/types";

/** Any member can set where the group meets at arrivals. Updates reach everyone live. */
export default function MeetingPoint({
  poolId,
  point,
  note,
  editable,
  onSaved,
}: {
  poolId: string;
  point: Point | null;
  note: string | null;
  editable: boolean;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(!point && editable);
  const [choice, setChoice] = useState<Point>(point ?? "arrival_gate");
  const [text, setText] = useState(note ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (choice === "other" && !text.trim()) return toast("Describe where to meet", "error");
    setBusy(true);
    const { error } = await createClient().rpc("set_meeting_point", { p_pool: poolId, p_point: choice, p_note: text });
    setBusy(false);
    if (error) return toast(error.message, "error");
    toast("Meeting point shared with the group", "success");
    setEditing(false);
    onSaved();
  }

  return (
    <Card className="grid grid-cols-1 gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Meeting point</h2>
        {point && editable && !editing && (
          <button className="text-xs text-muted underline" onClick={() => setEditing(true)}>
            change
          </button>
        )}
      </div>

      {point && !editing && (
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent/15 text-accent" aria-hidden>
            📍
          </span>
          <div>
            <p className="font-semibold">{MEETING_POINTS[point].label}</p>
            <p className="text-sm text-muted">{note || MEETING_POINTS[point].hint}</p>
          </div>
        </div>
      )}

      {!point && !editing && <p className="text-sm text-muted">Nobody has picked a meeting point yet.</p>}

      {editing && (
        <>
          <div role="radiogroup" aria-label="Meeting point" className="grid grid-cols-2 gap-2">
            {(Object.keys(MEETING_POINTS) as Point[]).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={choice === k}
                onClick={() => setChoice(k)}
                className={cx(
                  "rounded-xl border px-3 py-2 text-left",
                  choice === k ? "border-accent bg-accent/10" : "border-line",
                )}
              >
                <span className={cx("block text-sm font-semibold", choice === k && "text-accent")}>{MEETING_POINTS[k].label}</span>
                <span className="block text-[11px] text-muted">{MEETING_POINTS[k].hint}</span>
              </button>
            ))}
          </div>
          <Input
            value={text}
            maxLength={120}
            onChange={(e) => setText(e.target.value)}
            placeholder={choice === "other" ? "Where exactly?" : "Details, e.g. Gate 2, near the coffee shop"}
          />
          <Button onClick={save} disabled={busy} full>
            {busy && <Spinner />} Share with group
          </Button>
        </>
      )}
    </Card>
  );
}
