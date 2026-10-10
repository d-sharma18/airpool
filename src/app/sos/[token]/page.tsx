import type { Metadata } from "next";
import { Badge, Card, buttonClass } from "@/components/ui";
import { airportByIata } from "@/lib/airports";
import { formatCarNumber } from "@/lib/booking";
import { firstName, fmtTime } from "@/lib/format";
import { MEETING_POINTS, dropArea, formatPhone } from "@/lib/share";
import { createAdminClient } from "@/lib/supabase/server";
import type { Pool } from "@/lib/types";
import AutoRefresh from "./auto-refresh";
import SosMap from "./sos-map";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Airpool SOS · live location", robots: { index: false, follow: false } };

interface Share {
  token: string;
  pool_id: string;
  user_id: string;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  updated_at: string | null;
  created_at: string;
  expires_at: string;
  stopped: boolean;
}

/**
 * Public page behind an unguessable link the rider sent on WhatsApp. Shows their latest
 * location and the ride details. Phone numbers appear only if the group was already locked.
 */
export default async function SosPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = createAdminClient();
  const { data: share } = await db.from("sos_shares").select("*").eq("token", token).maybeSingle<Share>();

  if (!share || new Date(share.expires_at) < new Date()) {
    return (
      <main className="mx-auto grid min-h-dvh max-w-md place-items-center px-5">
        <Card className="text-center">
          <p className="font-semibold">This SOS link has expired</p>
          <p className="mt-1 text-sm text-muted">Links stop working after 6 hours. Call the rider, or 112 in an emergency.</p>
        </Card>
      </main>
    );
  }

  const [{ data: pool }, { data: members }, { data: sender }] = await Promise.all([
    db.from("pools").select("*").eq("id", share.pool_id).single<Pool>(),
    db
      .from("pool_members")
      .select("user_id, flight_iata, arrival_at, dest_zone, dest_label, profiles(verified_name, full_name, phone)")
      .eq("pool_id", share.pool_id),
    db.from("profiles").select("verified_name, full_name, phone").eq("id", share.user_id).single(),
  ]);
  const locked = pool?.status === "locked" || pool?.status === "completed";
  const airport = airportByIata(pool?.airport_iata);
  const name = (p: { verified_name: string | null; full_name: string | null } | null) => p?.verified_name ?? p?.full_name ?? "Rider";
  const senderName = name(sender);
  const order = pool?.plan?.drop_order ?? [];
  type M = { user_id: string; flight_iata: string | null; arrival_at: string; dest_zone: string; dest_label: string; profiles: { verified_name: string | null; full_name: string | null; phone: string | null } | null };
  const riders = ((members ?? []) as unknown as M[]).sort((a, b) => order.indexOf(a.user_id) - order.indexOf(b.user_id));
  const live = !share.stopped && share.updated_at && Date.now() - new Date(share.updated_at).getTime() < 5 * 60_000;

  return (
    <main className="mx-auto grid max-w-md grid-cols-1 gap-4 px-5 py-6">
      <AutoRefresh seconds={20} />
      <section>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-danger">Airpool SOS</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{senderName} shared their location</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          {share.stopped ? (
            <Badge>Sharing stopped</Badge>
          ) : live ? (
            <Badge tone="danger">● Live</Badge>
          ) : (
            <Badge tone="accent">Last known location</Badge>
          )}
          {share.updated_at && <Badge>Updated {fmtTime(share.updated_at)}</Badge>}
        </div>
      </section>

      {share.lat != null && share.lng != null ? (
        <>
          <SosMap lat={share.lat} lng={share.lng} label={senderName} airport={airport ?? null} />
          <a
            href={`https://www.openstreetmap.org/?mlat=${share.lat}&mlon=${share.lng}#map=17/${share.lat}/${share.lng}`}
            target="_blank"
            rel="noreferrer"
            className={buttonClass("ghost", true)}
          >
            Open location in maps
          </a>
          {share.accuracy_m != null && <p className="-mt-2 text-center text-xs text-muted">Accurate to about {Math.round(share.accuracy_m)} m</p>}
        </>
      ) : (
        <Card className="text-sm text-muted">Their phone hasn&apos;t shared a location yet. This page refreshes on its own.</Card>
      )}

      <div className="grid grid-cols-2 gap-2">
        {locked && sender?.phone ? (
          <a href={`tel:+91${sender.phone}`} className={buttonClass("primary")}>
            Call {firstName(senderName)}
          </a>
        ) : (
          <span />
        )}
        <a href="tel:112" className={buttonClass("danger")}>
          Call 112
        </a>
      </div>

      {pool && (
        <Card className="grid grid-cols-1 gap-2 text-sm">
          <p className="font-semibold">The ride</p>
          <p className="text-muted">
            From {airport?.name ?? pool.airport_iata} → {riders.map((r) => dropArea(pool.airport_iata, r.dest_zone, r.dest_label)).join(" → ")}
          </p>
          {pool.car_number && (
            <p>
              🚙 {pool.car_model || "Car"} <span className="font-mono">{formatCarNumber(pool.car_number)}</span>
              {pool.driver_name && ` · driver ${pool.driver_name}`}
            </p>
          )}
          {pool.meeting_point && <p>📍 Meeting point: {MEETING_POINTS[pool.meeting_point].label}{pool.meeting_note ? `: ${pool.meeting_note}` : ""}</p>}
          <p className="mt-1 font-semibold">Riders (Aadhaar-verified)</p>
          <ul className="grid gap-1">
            {riders.map((r) => (
              <li key={r.user_id}>
                {locked ? name(r.profiles) : firstName(name(r.profiles))}
                {locked && r.profiles?.phone && <span className="text-muted"> · {formatPhone(r.profiles.phone)}</span>}
                <span className="text-muted">
                  {" "}
                  · {r.flight_iata ?? "flight"} lands {fmtTime(r.arrival_at)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="text-center text-[11px] text-muted">
        This private link stops working at {fmtTime(share.expires_at)}. Map © OpenStreetMap contributors.
      </p>
    </main>
  );
}
