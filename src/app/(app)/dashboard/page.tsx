import Link from "next/link";
import { Badge, Card, buttonClass } from "@/components/ui";
import { airportByIata } from "@/lib/airports";
import { firstName, fmtDay, fmtTime } from "@/lib/format";
import { requireUser } from "@/lib/session";
import type { Pool, PoolMember } from "@/lib/types";

type Row = PoolMember & { pools: Pool & { pool_members: { count: number }[] } };

const STATUS_TONE = { open: "accent", locked: "ok", completed: "muted", cancelled: "danger" } as const;

export default async function Dashboard() {
  const { supabase, user, profile } = await requireUser();
  const { data } = await supabase
    .from("pool_members")
    .select("*, pools(*, pool_members(count))")
    .eq("user_id", user.id)
    .order("arrival_at", { ascending: false })
    .returns<Row[]>();

  const rows = data ?? [];
  const upcoming = rows.filter((r) => r.pools.status === "open" || r.pools.status === "locked");
  const past = rows.filter((r) => !upcoming.includes(r));

  return (
    <div className="grid gap-6">
      <section>
        <p className="text-sm text-muted">Hi {firstName(profile.verified_name ?? profile.full_name)},</p>
        <h1 className="text-2xl font-bold tracking-tight">Where are you landing?</h1>
      </section>

      {!profile.verified && (
        <Card className="border-accent/40 bg-accent/5">
          <p className="font-semibold">Verify your Aadhaar to start pooling</p>
          <p className="mt-1 text-sm text-muted">One time, about 2 minutes. Keeps every ride verified.</p>
          <Link href="/verify" className={`${buttonClass("primary", true)} mt-4`}>
            Verify now
          </Link>
        </Card>
      )}

      {profile.verified && (
        <Link href="/trip/new" className={buttonClass("primary", true)}>
          + Plan a shared ride
        </Link>
      )}

      <section className="grid gap-3">
        <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Upcoming</h2>
        {upcoming.length === 0 && (
          <Card className="grid gap-1 text-center">
            <p className="text-3xl" aria-hidden>
              ✈️
            </p>
            <p className="font-semibold">No rides planned</p>
            <p className="text-sm text-muted">
              {profile.verified
                ? "Add your flight and we'll find verified people landing with you, going your way."
                : "Verify once, then add your flight to find co-riders."}
            </p>
          </Card>
        )}
        {upcoming.map((r) => (
          <PoolRow key={r.pool_id} r={r} />
        ))}
      </section>

      {past.length > 0 && (
        <section className="grid gap-3">
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Past</h2>
          {past.map((r) => (
            <PoolRow key={r.pool_id} r={r} />
          ))}
        </section>
      )}
    </div>
  );
}

function PoolRow({ r }: { r: Row }) {
  const airport = airportByIata(r.pools.airport_iata);
  const count = r.pools.pool_members[0]?.count ?? 1;
  return (
    <Link href={`/pool/${r.pool_id}`}>
      <Card className="transition hover:border-accent/50">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs text-muted">
              {r.pools.airport_iata} · {fmtDay(r.arrival_at)} · {fmtTime(r.arrival_at)}
              {r.flight_iata && ` · ${r.flight_iata}`}
            </p>
            <p className="mt-1 truncate font-semibold">
              {airport?.city ?? r.pools.airport_iata} → {r.dest_label.split(",")[0]}
            </p>
          </div>
          <Badge tone={STATUS_TONE[r.pools.status]}>{r.pools.status}</Badge>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Badge>
            {count} rider{count > 1 ? "s" : ""}
          </Badge>
          {r.pools.women_only && <Badge tone="women">Women only</Badge>}
        </div>
      </Card>
    </Link>
  );
}
