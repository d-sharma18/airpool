/**
 * Seeds a ready-to-present demo on IndiGo 6E2134 into Jaipur (JAI).
 *
 *   npm run seed:demo                     # lands ~3 hours from now (IST)
 *   DEMO_DATE=2026-10-20 DEMO_TIME=14:30 npm run seed:demo
 *
 * Creates 6 demo users (verified in demo mode, 2 women), 4 open groups in different zones
 * (one women-only), pre-caches the flight (0 Aviationstack calls) and every route the demo
 * needs (works even if OSRM is slow). Safe to re-run: it deletes the previous demo first.
 */
import { createClient } from "@supabase/supabase-js";
import { airportByIata } from "../src/lib/airports";
import { findMatches, zoneFor, type CandidatePool } from "../src/lib/matching";
import { cacheKey, planDrops, type Point, type RoutePlan } from "../src/lib/osrm";

const DOMAIN = "demo.airpool.app";
const PASSWORD = process.env.DEMO_PASSWORD || "Airpool-demo-2026";
const FLIGHT = "6E2134";
const JAI = airportByIata("JAI")!;

type Who = "aarav" | "vikram" | "arjun" | "ananya" | "rohan" | "priya";
interface DemoUser {
  key: Who;
  name: string;
  gender: "M" | "F";
  phone: string;
  /** Hosts get an open group at this drop-off; presenters search live during the demo. */
  host?: { label: string; at: Point; womenOnly?: boolean; pax: number; checked: number; cabin: number; car?: "any" | "suv" };
  presenter?: { search: string; fallback: Point };
}

const USERS: DemoUser[] = [
  // Groups Rohan should see from "Mansarovar": same area, on your route, nearby zone.
  { key: "aarav", name: "Aarav Sharma", gender: "M", phone: "9000000101", host: { label: "Shipra Path, Mansarovar, Jaipur", at: { lat: 26.8705, lng: 75.7555 }, pax: 1, checked: 1, cabin: 1 } },
  { key: "vikram", name: "Vikram Singh", gender: "M", phone: "9000000102", host: { label: "Gandhi Path, Vaishali Nagar, Jaipur", at: { lat: 26.905, lng: 75.748 }, pax: 1, checked: 2, cabin: 1 } },
  { key: "arjun", name: "Arjun Mehta", gender: "M", phone: "9000000103", host: { label: "Ashok Marg, C Scheme, Jaipur", at: { lat: 26.911, lng: 75.8 }, pax: 2, checked: 2, cabin: 2, car: "suv" } },
  // The women-only group Priya should see.
  { key: "ananya", name: "Ananya Gupta", gender: "F", phone: "9000000104", host: { label: "Sector 7, Malviya Nagar, Jaipur", at: { lat: 26.8536, lng: 75.8155 }, womenOnly: true, pax: 1, checked: 1, cabin: 1 } },
  // Presenters: log in as them and plan a trip on the same flight.
  { key: "rohan", name: "Rohan Verma", gender: "M", phone: "9000000105", presenter: { search: "Mansarovar", fallback: { lat: 26.8756, lng: 75.7509 } } },
  { key: "priya", name: "Priya Nair", gender: "F", phone: "9000000106", presenter: { search: "Malviya Nagar", fallback: { lat: 26.8594, lng: 75.8098 } } },
];

const email = (k: Who) => `${k}@${DOMAIN}`;
const log = (...a: unknown[]) => console.log(...a);
const fail = (msg: string) => {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
};

/** Landing time: DEMO_DATE/DEMO_TIME, else ~3 hours from now in IST (on the half hour). */
function landing() {
  if (process.env.DEMO_DATE && process.env.DEMO_TIME) {
    return { date: process.env.DEMO_DATE, time: process.env.DEMO_TIME };
  }
  const ist = new Date(Date.now() + 5.5 * 3600_000 + 3 * 3600_000);
  ist.setUTCMinutes(ist.getUTCMinutes() < 30 ? 30 : 60, 0, 0);
  const iso = ist.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

async function photon(q: string, fallback: Point): Promise<Point & { name: string }> {
  try {
    const p = new URLSearchParams({ q, limit: "1", lang: "en", bbox: "68,6,98,37", lat: String(JAI.lat), lon: String(JAI.lng) });
    const r = await fetch(`https://photon.komoot.io/api/?${p}`, { signal: AbortSignal.timeout(8000) });
    const f = (await r.json()).features[0];
    return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], name: f.properties.name };
  } catch {
    return { ...fallback, name: `${q} (fallback)` };
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.");
  const db = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });

  const { date, time } = landing();
  const arrivalAt = `${date}T${time}:00+05:30`;
  log(`\nAirpool demo · ${FLIGHT} DEL → JAI · lands ${date} ${time} IST\n`);

  // 1. Remove the previous demo.
  const { data: list, error: listErr } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) fail(listErr.message);
  const old = list.users.filter((u) => u.email?.endsWith(`@${DOMAIN}`)).map((u) => u.id);
  if (old.length) {
    await db.from("pools").delete().in("created_by", old);
    await db.from("trip_requests").delete().in("user_id", old);
    for (const id of old) await db.auth.admin.deleteUser(id);
    log(`• removed previous demo (${old.length} users)`);
  }

  // 2. Users, verified in demo mode (no Aadhaar file; labelled "Demo" in the app).
  const ids = {} as Record<Who, string>;
  for (const u of USERS) {
    const { data, error } = await db.auth.admin.createUser({
      email: email(u.key),
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: u.name, phone: u.phone, upi_id: `${u.key}.demo@okaxis` },
    });
    if (error || !data.user) fail(`creating ${u.key}: ${error?.message}`);
    ids[u.key] = data.user!.id;
    const { error: pErr } = await db
      .from("profiles")
      .update({
        verified: true,
        verified_name: u.name,
        verified_gender: u.gender,
        aadhaar_last4: "0000",
        verified_at: new Date().toISOString(),
        phone_verified: true,
        birth_year: 1996,
        aadhaar_signature_ok: false,
        is_demo: true,
      })
      .eq("id", ids[u.key]);
    if (pErr) fail(`verifying ${u.key}: ${pErr.message}`);
  }
  log(`• created 6 demo users (2 women), all verified in demo mode`);

  // 3. Pre-cache the flight so the lookup costs 0 Aviationstack calls.
  const { error: fErr } = await db.from("flights").upsert(
    {
      flight_iata: FLIGHT,
      flight_date: date,
      found: true,
      fetched_at: new Date().toISOString(),
      info: {
        flight_iata: FLIGHT,
        airline: "IndiGo",
        departure_iata: "DEL",
        arrival_iata: "JAI",
        arrival_airport: JAI.name,
        terminal: "2",
        scheduled_arrival: arrivalAt,
        estimated_arrival: null,
        status: "scheduled",
      },
    },
    { onConflict: "flight_iata,flight_date" },
  );
  if (fErr) fail(`caching flight: ${fErr.message}`);
  log(`• cached ${FLIGHT} for ${date} in the flights table`);

  // 4. One open group per host, built from a saved trip request (exactly what the app does).
  const groups: { host: DemoUser; poolId: string }[] = [];
  for (const u of USERS.filter((x) => x.host)) {
    const h = u.host!;
    const zone = zoneFor("JAI", h.at)?.id ?? "other";
    const { data: req, error: rErr } = await db
      .from("trip_requests")
      .insert({
        user_id: ids[u.key],
        flight_iata: FLIGHT,
        arrival_date: date,
        arrival_at: arrivalAt,
        arrival_source: "aviationstack",
        airport_iata: "JAI",
        dest_label: h.label,
        dest_lat: h.at.lat,
        dest_lng: h.at.lng,
        zone,
        pax: h.pax,
        checked_bags: h.checked,
        cabin_bags: h.cabin,
        preferred_car: h.car ?? "any",
        women_only: !!h.womenOnly,
      })
      .select("id")
      .single();
    if (rErr) fail(`trip for ${u.key}: ${rErr.message}`);
    const { data: pool, error: gErr } = await db
      .from("pools")
      .insert({ created_by: ids[u.key], airport_iata: "JAI", zone, women_only: !!h.womenOnly, max_pax: h.car === "suv" ? 6 : 4 })
      .select("id")
      .single();
    if (gErr) fail(`group for ${u.key}: ${gErr.message}`);
    const { error: mErr } = await db.from("pool_members").insert({
      pool_id: pool!.id,
      user_id: ids[u.key],
      flight_iata: FLIGHT,
      arrival_at: arrivalAt,
      dest_label: h.label,
      dest_lat: h.at.lat,
      dest_lng: h.at.lng,
      dest_zone: zone,
      pax: h.pax,
      cabin_bags: h.cabin,
      checked_bags: h.checked,
    });
    if (mErr) fail(`joining ${u.key}: ${mErr.message}`);
    await db.from("trip_requests").update({ status: "matched", pool_id: pool!.id }).eq("id", req!.id);
    groups.push({ host: u, poolId: pool!.id });
    log(`• ${u.name.split(" ")[0]}'s ${h.womenOnly ? "women-only " : ""}group → ${zoneFor("JAI", h.at)?.name ?? "other"}`);
  }

  // 5. Where presenters will search (the first Photon suggestion), and what they'll see.
  log("\nChecking matches with the real matching engine:");
  const presenters: Record<string, Point> = {};
  const candidates: CandidatePool[] = groups.map((g) => ({
    id: g.poolId,
    airportIata: "JAI",
    status: "open",
    womenOnly: !!g.host.host!.womenOnly,
    maxPax: g.host.host!.car === "suv" ? 6 : 4,
    hostFirstName: g.host.name.split(" ")[0],
    members: [{ userId: ids[g.host.key], ...g.host.host!.at, arrivalAt, pax: g.host.host!.pax, flight: FLIGHT, verified: true, gender: g.host.gender }],
  }));
  for (const u of USERS.filter((x) => x.presenter)) {
    const at = await photon(u.presenter!.search, u.presenter!.fallback);
    presenters[u.key] = at;
    const womenOnly = u.gender === "F";
    const matches = findMatches(
      { userId: ids[u.key], airportIata: "JAI", arrivalAt, ...at, pax: 1, flight: FLIGHT, womenOnly, verified: true, gender: u.gender },
      candidates,
      JAI,
    );
    log(`  ${u.name} searching "${u.presenter!.search}" → picks "${at.name}"${womenOnly ? " (women-only on)" : ""}`);
    for (const m of matches) log(`    ${m.label.padEnd(14)} ${m.womenOnly ? "· Women only " : ""}${m.hostFirstName}'s group · ${m.maxKm} km`);
    if (!matches.length) log("    (no matches. Check zones in src/config/matching.ts)");
  }

  // 6. Pre-cache every route the demo can request: each group alone, and each group + presenter.
  log("\nPre-caching routes (OSRM, 1 request/second):");
  let last = 0;
  const throttle = async () => {
    const wait = last + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
  };
  const combos: Point[][] = [];
  for (const g of groups) {
    const host = g.host.host!.at;
    combos.push([host]);
    const presenter = g.host.host!.womenOnly ? presenters.priya : presenters.rohan;
    if (presenter) combos.push([host, presenter], [presenter, host]);
  }
  let osrmDown = 0;
  for (const stops of combos) {
    const plan: RoutePlan = await planDrops(JAI, stops, { throttle });
    if (plan.source === "straight-line") osrmDown++;
    const { error } = await db.from("route_cache").upsert({ key: cacheKey(JAI, stops), result: plan });
    if (error) fail(`caching route: ${error.message}`);
  }
  log(`• cached ${combos.length} routes${osrmDown ? ` (${osrmDown} approximate because OSRM didn't answer; re-run later to refresh)` : ""}`);

  log(`
Done. Log in at /login with any of these (password: ${PASSWORD}):
  Presenter (same area / on route / nearby zone): ${email("rohan")}
  Presenter (women-only):                         ${email("priya")}
  Group hosts: ${email("aarav")}, ${email("vikram")}, ${email("arjun")}, ${email("ananya")}

Demo script:
  1. Log in as Rohan → Plan a shared ride → Landing at JAI → flight ${FLIGHT} → date ${date} → Look up
     (time fills in from the cache, with no Aviationstack call).
  2. Destination: type "Mansarovar" and pick the first suggestion → Save & find co-riders.
     You'll see Same area (Aarav), On your route (Vikram), Nearby zone (Arjun).
  3. Log out, log in as Priya, same flight, destination "Malviya Nagar", turn on Women-only ride.
     Only Ananya's women-only group shows up.
  4. Open a second browser as the host (e.g. Aarav) to watch the join happen live.
`);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
