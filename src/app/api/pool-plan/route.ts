import { NextResponse, type NextRequest } from "next/server";
import { askJson } from "@/lib/ai";
import { airportByIata } from "@/lib/airports";
import { VEHICLES, estimateFareByRules, recommendVehicleByRules, splitFare, vehicleFromClass } from "@/lib/fare";
import { planDrops } from "@/lib/osrm";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import type { Pool, PoolMember, PoolPlan, VehicleRecommendation } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { poolId, actualFare } = (await req.json().catch(() => ({}))) as { poolId?: string; actualFare?: number };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  // RLS makes these return nothing unless the caller is a member.
  const { data: pool } = await supabase.from("pools").select("*").eq("id", poolId).maybeSingle<Pool>();
  if (!pool) return NextResponse.json({ error: "Pool not found" }, { status: 404 });
  const { data: members } = await supabase.from("pool_members").select("*").eq("pool_id", pool.id).returns<PoolMember[]>();
  if (!members?.length) return NextResponse.json({ error: "No riders" }, { status: 400 });

  const airport = airportByIata(pool.airport_iata);
  if (!airport) return NextResponse.json({ error: "Unknown airport" }, { status: 400 });

  const entered = typeof actualFare === "number" && actualFare > 0 && actualFare < 100_000 ? Math.round(actualFare) : null;
  const keptActual = pool.plan?.fare_source === "actual" ? pool.plan.fare_total : null;
  const actual = entered ?? keptActual;
  const signature = JSON.stringify([
    pool.max_pax,
    actual,
    members
      .map((m) => [m.user_id, m.pax, m.cabin_bags, m.checked_bags, m.dest_lat, m.dest_lng])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ]);
  if (!entered && pool.plan?.signature === signature) return NextResponse.json(pool.plan);

  const load = members.reduce(
    (s, m) => ({ pax: s.pax + m.pax, cabin: s.cabin + m.cabin_bags, checked: s.checked + m.checked_bags }),
    { pax: 0, cabin: 0, checked: 0 },
  );

  const route = await planDrops(airport, members.map((m) => ({ lat: m.dest_lat, lng: m.dest_lng })));
  const vehicle = await recommendVehicle(load, route.totalKm, airport.city);

  // Total fare: what the host actually paid, else an AI estimate sanity-checked against our rate card.
  let fareTotal = actual ?? 0;
  let fareSource: PoolPlan["fare_source"] = "actual";
  let fareNote = "Split using the fare the host paid.";
  if (!fareTotal) {
    const ruleFare = estimateFareByRules(vehicle.vehicle, route.totalKm);
    const ai = await askJson<{ fare: number; note: string }>(
      `Estimate the typical app-cab fare in ${airport.city}, India for a ${VEHICLES[vehicle.vehicle].uber} / ${VEHICLES[vehicle.vehicle].ola} ` +
        `ride from ${airport.name} airport covering ${route.totalKm.toFixed(1)} km in about ${Math.round(route.totalMin)} minutes ` +
        `with ${members.length - 1} intermediate stop(s), at ${new Date(members[0].arrival_at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} IST. ` +
        `Include airport pickup fees and typical surge. Return {"fare": number (INR, whole), "note": string (max 20 words, what drives the price)}.`,
    );
    const aiFare = Number(ai?.data.fare);
    if (ai && aiFare >= ruleFare * 0.5 && aiFare <= ruleFare * 2) {
      fareTotal = Math.round(aiFare / 10) * 10;
      fareSource = ai.source;
      fareNote = String(ai.data.note ?? "").slice(0, 160);
    } else {
      fareTotal = ruleFare;
      fareSource = "rules";
      fareNote = `Rate-card estimate for ${route.totalKm.toFixed(1)} km. Enter the real fare after booking.`;
    }
  }

  const dropIndex = new Map(route.order.map((memberIdx, pos) => [members[memberIdx].user_id, pos]));
  const shares = splitFare(
    fareTotal,
    route.legKm,
    members.map((m) => ({ user_id: m.user_id, pax: m.pax, drop: dropIndex.get(m.user_id)! })),
    pool.created_by,
  );

  const plan: PoolPlan = {
    signature,
    computed_at: new Date().toISOString(),
    vehicle,
    drop_order: route.order.map((i) => members[i].user_id),
    total_km: Math.round(route.totalKm * 10) / 10,
    total_min: Math.round(route.totalMin),
    geometry: simplify(route.geometry, 400),
    fare_total: fareTotal,
    fare_source: fareSource,
    fare_note: fareNote,
    shares,
  };

  await createAdminClient().from("pools").update({ plan }).eq("id", pool.id);
  return NextResponse.json(plan);
}

async function recommendVehicle(
  load: { pax: number; cabin: number; checked: number },
  km: number,
  city: string,
): Promise<VehicleRecommendation> {
  const rules = recommendVehicleByRules(load);
  const options = Object.entries(VEHICLES)
    .map(([k, v]) => `${k}: ${v.label} (${v.uber} / ${v.ola}), ${v.seats} seats, boot ≈ ${v.boot} large suitcases`)
    .join("\n");
  const ai = await askJson<{ vehicle: string; reason: string }>(
    `Pick the cheapest cab class that comfortably fits this airport group in ${city}.\n` +
      `Riders: ${load.pax}. Checked suitcases: ${load.checked}. Cabin bags/backpacks: ${load.cabin}. Trip: ${km.toFixed(1)} km.\n` +
      `Options:\n${options}\n` +
      `Return {"vehicle": one of "mini"|"sedan"|"suv"|"xl", "reason": string (max 25 words, mention the luggage)}.`,
  );
  const v = ai ? vehicleFromClass(String(ai.data.vehicle)) : null;
  // Never accept an AI pick with fewer seats than riders.
  if (!ai || !v || VEHICLES[v].seats < load.pax) return rules;
  const spec = VEHICLES[v];
  return {
    vehicle: v,
    label: spec.label,
    uber: spec.uber,
    ola: spec.ola,
    seats: spec.seats,
    reason: String(ai.data.reason ?? rules.reason).slice(0, 200),
    source: ai.source,
  };
}

function simplify(points: [number, number][], max: number) {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out = Array.from({ length: max }, (_, i) => points[Math.floor(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}
