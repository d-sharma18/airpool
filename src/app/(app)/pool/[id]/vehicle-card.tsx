import { Badge } from "@/components/ui";
import type { VehicleRecommendation } from "@/lib/types";
import { VEHICLES } from "@/lib/vehicle";

const AI_NAME = { gemini: "Gemini", groq: "Groq" } as const;

/** The group's recommended car with its one-line reason. Older saved plans may lack newer fields. */
export default function VehicleCard({ v }: { v: VehicleRecommendation }) {
  const fromAi = v.source !== "rules";
  const pct = typeof v.confidence === "number" ? Math.round(v.confidence * 100) : null;

  return (
    <div className="grid grid-cols-1 gap-2 rounded-xl bg-surface-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted">Recommended car</p>
          <p className="text-lg font-semibold">{v.label}</p>
        </div>
        <Badge tone={fromAi ? "accent" : "muted"}>
          {fromAi ? `AI · ${AI_NAME[v.source as "gemini" | "groq"]}` : "Rules"}
          {pct !== null && ` · ${pct}%`}
        </Badge>
      </div>

      <p className="text-sm">{v.reason}</p>

      <p className="text-xs text-muted">
        Book {v.uber} or {v.ola} · {v.seats} seats
        {v.load && (
          <>
            {" "}
            · group: {v.load.pax} {v.load.pax === 1 ? "person" : "people"}, {v.load.checked} check-in + {v.load.cabin} cabin ={" "}
            {v.load.bagUnits} bag{v.load.bagUnits === 1 ? "" : "s"}
          </>
        )}
      </p>

      {v.overridden && (
        <p className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted">
          {AI_NAME[v.overridden.source]} suggested {an(v.overridden.aiPick)}, but{" "}
          {v.overridden.why === "too_small"
            ? "that's too small for this group"
            : "a bigger car isn't needed and costs more"}
          , so we used the rule-based pick.
        </p>
      )}
    </div>
  );
}

const an = (c: keyof typeof VEHICLES) => `${c === "suv" ? "an" : "a"} ${VEHICLES[c]?.label ?? c}`;
