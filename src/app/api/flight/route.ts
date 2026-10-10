import { NextResponse, type NextRequest } from "next/server";
import { allow } from "@/lib/rate-limit";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import type { FlightInfo } from "@/lib/types";
import { FLIGHT_RE, normalizeFlight } from "@/lib/validation";

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

/** `manual: true` tells the form to fall back to typing the arrival time. */
const fail = (error: string, status: number) => NextResponse.json({ error, manual: true }, { status });

/**
 * Server-only Aviationstack lookup. The key never reaches the browser, and every answer
 * (found or not) is stored in `flights`, so one flight+date costs at most one API call.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (!(await allow("flight", user.id))) {
    return fail("You've looked up a lot of flights. Enter your arrival time below, or try again in an hour.", 429);
  }

  const flight = normalizeFlight(req.nextUrl.searchParams.get("flight") ?? "");
  const date = req.nextUrl.searchParams.get("date") ?? "";
  if (!FLIGHT_RE.test(flight)) return NextResponse.json({ error: "Use the airline code and number, like 6E2134 or AI487." }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Pick your arrival date first." }, { status: 400 });

  const admin = createAdminClient();
  const { data: cached } = await admin
    .from("flights")
    .select("found, info")
    .eq("flight_iata", flight)
    .eq("flight_date", date)
    .maybeSingle();
  if (cached) {
    return cached.found
      ? NextResponse.json({ ...cached.info, cached: true })
      : fail(`We couldn't find ${flight} on that date. Enter your arrival time below.`, 404);
  }

  const key = process.env.AVIATIONSTACK_KEY;
  if (!key) return fail("Flight lookup isn't set up. Enter your arrival time below.", 503);
  // Keep a little headroom under the 100 calls/month free plan.
  if (!(await allow("aviationstackMonth"))) {
    return fail("Our free flight lookups are used up for this month. Enter your arrival time below.", 429);
  }

  // The free plan only supports HTTP.
  const res = await fetch(
    `http://api.aviationstack.com/v1/flights?access_key=${encodeURIComponent(key)}&flight_iata=${flight}&limit=20`,
    { cache: "no-store", signal: AbortSignal.timeout(10_000) },
  ).catch(() => null);
  const body = res ? await res.json().catch(() => null) : null;

  // Outages and quota errors aren't answers about the flight, so they aren't cached.
  if (!res || !body) return fail("Flight lookup is unavailable right now. Enter your arrival time below.", 502);
  if (body.error) {
    const quota = ["usage_limit_reached", "monthly_limit_reached", "rate_limit_reached"].includes(body.error.code);
    return fail(
      quota
        ? "Our free flight lookups are used up for this month. Enter your arrival time below."
        : "Flight lookup failed. Enter your arrival time below.",
      quota ? 429 : 502,
    );
  }

  const toInfo = (f: AvsFlight): FlightInfo => ({
    flight_iata: flight,
    airline: f.airline?.name ?? null,
    departure_iata: f.departure?.iata ?? null,
    arrival_iata: f.arrival?.iata ?? null,
    arrival_airport: f.arrival?.airport ?? null,
    terminal: f.arrival?.terminal ?? null,
    scheduled_arrival: asIst(f.arrival?.scheduled),
    estimated_arrival: asIst(f.arrival?.estimated),
    status: f.flight_status ?? null,
  });

  // One API call often returns several days of the same flight; cache them all.
  const byDate = new Map<string, FlightInfo>();
  for (const f of (body.data ?? []) as AvsFlight[]) {
    if (f.flight_date && !byDate.has(f.flight_date)) byDate.set(f.flight_date, toInfo(f));
  }
  const rows: { flight_iata: string; flight_date: string; found: boolean; info: FlightInfo | null }[] = [...byDate].map(
    ([flight_date, info]) => ({ flight_iata: flight, flight_date, found: true, info }),
  );
  if (!byDate.has(date)) rows.push({ flight_iata: flight, flight_date: date, found: false, info: null });
  await admin.from("flights").upsert(rows, { onConflict: "flight_iata,flight_date", ignoreDuplicates: true });

  const info = byDate.get(date);
  return info ? NextResponse.json(info) : fail(`We couldn't find ${flight} on that date. Enter your arrival time below.`, 404);
}
