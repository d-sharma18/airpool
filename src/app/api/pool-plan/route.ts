import { NextResponse, type NextRequest } from "next/server";
import { allow, tooMany } from "@/lib/rate-limit";
import { askJson } from "@/lib/ai";
import { airportByIata } from "@/lib/airports";
import { estimateFareByRules, formulaSplit } from "@/lib/fare";
import { planDropsShared } from "@/lib/osrm-server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import type { Pool, PoolMember, PoolPlan, PreferredCar } from "@/lib/types";
import { VEHICLES, type RiderLoad } from "@/lib/vehicle";
import { recommendVehicle } from "@/lib/vehicle-ai";

export const runtime = "nodejs";

/**
 * Builds the group's plan: drop order (OSRM trip), car, estimated fare and an estimated
 * split by the distance formula. The final split happens in /api/fare-split once the
 * booker enters the real fare.
 */
export async function POST(req: NextRequest) {
  const { poolId } = (await req.json().catch(() => ({}))) as { poolId?: string };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  // RLS makes these return nothing unless the caller is a member.
  const { data: pool } = await supabase.from("pools").select("*").eq("id", poolId).maybeSingle<Pool>();
  if (!pool) return NextResponse.json({ error: "Group not found" }, { status: 404 });
  const { data: members } = await supabase.from("pool_members").select("*").eq("pool_id", pool.id).returns<PoolMember[]>();
  if (!members?.length) return NextResponse.json({ error: "No riders" }, { status: 400 });

  const airport = airportByIata(pool.airport_iata);
  if (!airport) return NextResponse.json({ error: "Unknown airport" }, { status: 400 });

  // Riders' preferred cars live on their (private) trip requests; read them server-side.
  const admin = createAdminClient();
  const { data: prefs } = await admin
    .from("trip_requests")
    .select("user_id, preferred_car")
    .eq("pool_id", pool.id)
    .eq("status", "matched")
    .returns<{ user_id: string; preferred_car: PreferredCar }[]>();
  const riders: RiderLoad[] = members.map((m) => ({
    pax: m.pax,
    checked: m.checked_bags,
    cabin: m.cabin_bags,
    preferred: prefs?.find((p) => p.user_id === m.user_id)?.preferred_car ?? "any",
  }));

  const signature = JSON.stringify([
    "v3",
    pool.max_pax,
    members
      .map((m, i) => [m.user_id, m.pax, m.cabin_bags, m.checked_bags, m.dest_lat, m.dest_lng, riders[i].preferred])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ]);
  if (pool.plan?.signature === signature) return NextResponse.json(pool.plan);
  // Recomputing calls OSRM and the AI, so it's limited; cached plans above are free.
  if (!(await allow("poolPlan", user.id))) return tooMany("The ride plan is refreshing too often. Try again in a few minutes.");

  const route = await planDropsShared(airport, members.map((m) => ({ lat: m.dest_lat, lng: m.dest_lng })));
  const vehicle = await recommendVehicle(riders, { city: airport.city, km: route.totalKm });

  // Estimated total: AI estimate sanity-checked against our rate card.
  const ruleFare = estimateFareByRules(vehicle.vehicle, route.totalKm);
  const ai = await askJson<{ fare: number; note: string }>(
    `Estimate the typical app-cab fare in ${airport.city}, India for a ${VEHICLES[vehicle.vehicle].uber} / ${VEHICLES[vehicle.vehicle].ola} ` +
      `ride from ${airport.name} airport covering ${route.totalKm.toFixed(1)} km in about ${Math.round(route.totalMin)} minutes ` +
      `with ${members.length - 1} intermediate stop(s), at ${new Date(members[0].arrival_at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} IST. ` +
      `Include airport pickup fees and typical surge. Return {"fare": number (INR, whole), "note": string (max 20 words, what drives the price)}.`,
  );
  const aiFare = Number(ai?.data.fare);
  const useAi = !!ai && aiFare >= ruleFare * 0.5 && aiFare <= ruleFare * 2;
  const fareTotal = useAi ? Math.round(aiFare / 10) * 10 : ruleFare;

  // Riders in drop order, each with their road distance from the airport.
  const splitInput = route.order.map((i) => ({ user_id: members[i].user_id, km: route.stopKm[i] }));

  const plan: PoolPlan = {
    signature,
    computed_at: new Date().toISOString(),
    vehicle,
    drop_order: splitInput.map((r) => r.user_id),
    total_km: Math.round(route.totalKm * 10) / 10,
    total_min: Math.round(route.totalMin),
    geometry: simplify(route.geometry, 400),
    route_source: route.source,
    fare_total: fareTotal,
    fare_source: useAi ? ai!.source : "rules",
    fare_note: useAi ? String(ai!.data.note ?? "").slice(0, 160) : `Rate-card estimate for ${route.totalKm.toFixed(1)} km.`,
    shares: formulaSplit(fareTotal, splitInput, pool.created_by),
    split_method: "formula",
    final: false,
  };

  await admin.from("pools").update({ plan }).eq("id", pool.id);
  return NextResponse.json(plan);
}

function simplify(points: [number, number][], max: number) {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out = Array.from({ length: max }, (_, i) => points[Math.floor(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}
