import { NextResponse, type NextRequest } from "next/server";
import { allow, tooMany } from "@/lib/rate-limit";
import { airportByIata } from "@/lib/airports";
import { findMatches, type CandidatePool, type Gender } from "@/lib/matching";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import type { Profile, TripRequest } from "@/lib/types";

export const runtime = "nodejs";

interface PoolRow {
  id: string;
  airport_iata: string;
  status: string;
  women_only: boolean;
  max_pax: number;
  created_by: string;
  pool_members: {
    user_id: string;
    dest_lat: number;
    dest_lng: number;
    arrival_at: string;
    pax: number;
    flight_iata: string | null;
    profiles: {
      verified: boolean;
      verified_gender: Gender | null;
      verified_name: string | null;
      full_name: string | null;
      women_only_blocked: boolean;
      blocked: boolean;
    } | null;
  }[];
}

/**
 * Ranks open groups for one of the caller's saved trip requests.
 * Candidates are read with the service role (groups are private to their members),
 * but only zone names, distances and counts leave the server, never addresses.
 */
export async function POST(req: NextRequest) {
  const { requestId } = (await req.json().catch(() => ({}))) as { requestId?: string };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (!(await allow("matches", user.id))) return tooMany("Too many searches in a row. Give it a minute and try again.");

  const [{ data: trip }, { data: me }] = await Promise.all([
    supabase.from("trip_requests").select("*").eq("id", requestId).maybeSingle<TripRequest>(),
    supabase
      .from("profiles")
      .select("verified, verified_gender, women_only_blocked, blocked")
      .eq("id", user.id)
      .single<Pick<Profile, "verified" | "verified_gender"> & { women_only_blocked: boolean; blocked: boolean }>(),
  ]);
  if (!trip) return NextResponse.json({ error: "Trip request not found" }, { status: 404 });
  if (trip.status !== "searching") return NextResponse.json({ error: `This trip is already ${trip.status}` }, { status: 409 });
  if (!me?.verified) return NextResponse.json({ error: "Only verified riders can be matched. Verify your Aadhaar first." }, { status: 403 });
  if (me.blocked) return NextResponse.json({ error: "Your account is blocked. Contact support." }, { status: 403 });

  const airport = airportByIata(trip.airport_iata);
  if (!airport) return NextResponse.json({ error: "Unknown airport" }, { status: 400 });

  const { data: rows, error } = await createAdminClient()
    .from("pools")
    .select(
      "id, airport_iata, status, women_only, max_pax, created_by, pool_members(user_id, dest_lat, dest_lng, arrival_at, pax, flight_iata, profiles(verified, verified_gender, verified_name, full_name, women_only_blocked, blocked))",
    )
    .eq("status", "open")
    .eq("airport_iata", trip.airport_iata)
    .order("created_at", { ascending: false })
    .limit(300)
    .returns<PoolRow[]>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const pools: CandidatePool[] = (rows ?? []).map((p) => {
    const host = p.pool_members.find((m) => m.user_id === p.created_by)?.profiles;
    return {
      id: p.id,
      airportIata: p.airport_iata,
      status: p.status,
      womenOnly: p.women_only,
      maxPax: p.max_pax,
      hostFirstName: (host?.verified_name ?? host?.full_name ?? "Rider").split(" ")[0],
      members: p.pool_members.map((m) => ({
        userId: m.user_id,
        lat: m.dest_lat,
        lng: m.dest_lng,
        arrivalAt: m.arrival_at,
        pax: m.pax,
        flight: m.flight_iata,
        verified: !!m.profiles?.verified && !m.profiles.blocked,
        // Someone reported on a women-only ride no longer counts as eligible for women-only groups.
        gender: m.profiles?.women_only_blocked ? null : (m.profiles?.verified_gender ?? null),
      })),
    };
  });

  const matches = findMatches(
    {
      userId: user.id,
      airportIata: trip.airport_iata,
      arrivalAt: trip.arrival_at,
      lat: trip.dest_lat,
      lng: trip.dest_lng,
      pax: trip.pax,
      flight: trip.flight_iata,
      womenOnly: trip.women_only,
      verified: me.verified,
      gender: me.women_only_blocked ? null : me.verified_gender,
    },
    pools,
    airport,
  );

  return NextResponse.json({ matches });
}
