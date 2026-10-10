import Link from "next/link";
import { Badge, Card, buttonClass } from "@/components/ui";
import { airportByIata } from "@/lib/airports";
import { firstName, inr } from "@/lib/format";
import { OSRM_ATTRIBUTION } from "@/lib/osrm";
import type { Pool } from "@/lib/types";

export default function FareBreakdownView({
  pool,
  me,
  people,
}: {
  pool: Pool;
  me: string;
  people: { id: string; name: string | null }[];
}) {
  const id = pool.id;
  const user = { id: me };
  const plan = pool.plan;
  const nameOf = (uid: string) => firstName(people.find((p) => p.id === uid)?.name);
  const airport = airportByIata(pool.airport_iata);

  const back = (
    <Link href={`/pool/${id}`} className="text-sm text-muted underline">
      ← Back to group
    </Link>
  );

  if (!plan?.shares?.length) {
    return (
      <div className="grid gap-4">
        {back}
        <Card className="text-sm text-muted">The route and fare are still being worked out. Check back in a moment.</Card>
      </div>
    );
  }

  const byAi = plan.final && plan.split_method === "ai";
  const totalKm = plan.shares.reduce((s, x) => s + x.km, 0);
  const sum = plan.shares.reduce((s, x) => s + x.amount, 0);
  const shares = plan.drop_order.map((uid) => plan.shares.find((s) => s.user_id === uid)!).filter(Boolean);

  return (
    <div className="grid grid-cols-1 gap-4 pb-6">
      {back}
      <section>
        <p className="font-mono text-xs text-muted">{airport?.iata} · fare breakdown</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Who pays what</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          {byAi ? (
            <Badge tone="accent">✨ calculated by AI</Badge>
          ) : (
            <Badge>{plan.final ? "calculated by formula" : "estimate · calculated by formula"}</Badge>
          )}
          {plan.final ? <Badge tone="ok">Final fare</Badge> : <Badge>Waiting for the final fare</Badge>}
        </div>
      </section>

      <Card className="grid grid-cols-1 gap-1">
        <p className="text-xs text-muted">{plan.final ? "Total paid by the booker" : "Estimated total"}</p>
        <p className="font-mono text-3xl">{inr(plan.fare_total)}</p>
        <p className="text-xs text-muted">
          Booked and paid by {nameOf(pool.created_by)}
          {pool.created_by === user.id && " (you)"} · everyone else pays them back.
        </p>
      </Card>

      <div className="grid grid-cols-1 overflow-hidden rounded-2xl border border-line bg-surface">
        {shares.map((s, i) => (
          <div key={s.user_id} className="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1 border-b border-line p-4 last:border-b-0">
            <span className="row-span-2 grid size-7 place-items-center rounded-full bg-surface-2 font-mono text-xs">{i + 1}</span>
            <p className="font-medium">
              {nameOf(s.user_id)}
              {s.user_id === user.id && <span className="ml-1 text-xs text-muted">(you)</span>}
              {s.user_id === pool.created_by && (
                <span className="ml-1.5">
                  <Badge tone="accent">booker</Badge>
                </span>
              )}
            </p>
            <p className={`row-span-2 self-center font-mono text-lg ${s.user_id === user.id ? "text-accent" : ""}`}>{inr(s.amount)}</p>
            <p className="text-xs text-muted">
              {s.km} km by road · formula {inr(s.formula ?? s.amount)}
            </p>
            {s.reason && <p className="col-span-2 col-start-2 text-sm">{s.reason}</p>}
          </div>
        ))}
        <div className="flex items-center justify-between border-t border-line bg-surface-2/50 px-4 py-3 text-sm">
          <span className="text-muted">Total · {Math.round(totalKm * 10) / 10} km of rides</span>
          <span className="font-mono">{inr(sum)}</span>
        </div>
      </div>

      <Card className="grid grid-cols-1 gap-2 text-sm text-muted">
        <p className="font-medium text-ink">How this was worked out</p>
        <p>
          Each rider&apos;s fair share is <span className="text-ink">total fare × their road distance ÷ everyone&apos;s distances added up</span>.
          Distances are direct road distances from the airport, so nobody pays for detours made to drop someone else.
          The drop order is OSRM&apos;s fastest route from the airport.
        </p>
        {byAi ? (
          <p>
            Gemini proposed these amounts. We only accept an AI split when it adds up exactly to the fare and every
            amount is within 10% of the formula. This one passed both checks.
          </p>
        ) : (
          <p>{plan.split_note ?? "The formula was used directly"}. Rounding differences go to the booker.</p>
        )}
        <p className="text-[11px]">{OSRM_ATTRIBUTION}</p>
      </Card>

      <Link href={`/pool/${id}`} className={buttonClass("ghost", true)}>
        Back to group
      </Link>
    </div>
  );
}
