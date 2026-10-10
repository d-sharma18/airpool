import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import type { FlightInfo } from "@/lib/types";

const CACHE_HOURS = 6;

// Aviationstack labels local airport time as "+00:00"; reinterpret the wall-clock time as IST.
const asIst = (t?: string | null) => (t ? `${t.slice(0, 16)}:00+05:30` : null);

interface AvsFlight {
  flight_date: string;
  flight_status: string;
  airline?: { name?: string };
  flight?: { iata?: string };
  departure?: { iata?: string };
  arrival?: { iata?: string; airport?: string; terminal?: string; scheduled?: string; estimated?: string };
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const flight = (req.nextUrl.searchParams.get("flight") ?? "").toUpperCase().replace(/\s/g, "");
  const date = req.nextUrl.searchParams.get("date") ?? "";
  if (!/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(flight)) {
    return NextResponse.json({ error: "Enter a flight number like 6E2134 or AI101" }, { status: 400 });
  }

  const key = process.env.AVIATIONSTACK_KEY;
  if (!key) return NextResponse.json({ error: "Flight lookup is not configured. Enter details manually." }, { status: 503 });

  const admin = createAdminClient();
  const cacheKey = `${flight}|${date}`;
  const { data: cached } = await admin.from("flight_cache").select("data, fetched_at").eq("key", cacheKey).maybeSingle();
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_HOURS * 3600_000) {
    return NextResponse.json(cached.data);
  }

  // The free plan only supports HTTP.
  const res = await fetch(
    `http://api.aviationstack.com/v1/flights?access_key=${encodeURIComponent(key)}&flight_iata=${flight}&limit=10`,
    { cache: "no-store", signal: AbortSignal.timeout(10_000) },
  ).catch(() => null);
  if (!res?.ok) return NextResponse.json({ error: "Flight service unavailable. Enter details manually." }, { status: 502 });
  const body = await res.json();
  if (body.error) {
    return NextResponse.json({ error: body.error.message ?? "Flight lookup failed" }, { status: 502 });
  }

  const list: AvsFlight[] = body.data ?? [];
  const f = list.find((x) => x.flight_date === date) ?? list[0];
  if (!f) return NextResponse.json({ error: `No live data for ${flight}. Enter details manually.` }, { status: 404 });

  const info: FlightInfo = {
    flight_iata: f.flight?.iata ?? flight,
    airline: f.airline?.name ?? null,
    departure_iata: f.departure?.iata ?? null,
    arrival_iata: f.arrival?.iata ?? null,
    arrival_airport: f.arrival?.airport ?? null,
    terminal: f.arrival?.terminal ?? null,
    scheduled_arrival: asIst(f.arrival?.scheduled),
    estimated_arrival: asIst(f.arrival?.estimated),
    status: f.flight_status ?? null,
  };
  await admin.from("flight_cache").upsert({ key: cacheKey, data: info, fetched_at: new Date().toISOString() });
  return NextResponse.json(info);
}
