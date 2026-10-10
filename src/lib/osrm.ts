import { kmBetween } from "./geo";

/** Public OSRM demo server. Its usage policy allows at most 1 request per second. */
export const OSRM_URL = "https://router.project-osrm.org";
export const OSRM_ATTRIBUTION = "Routes © OSRM (project-osrm.org) · Map data © OpenStreetMap contributors";

export interface Point {
  lat: number;
  lng: number;
}

export interface RoutePlan {
  /** Indices into `stops`, in drop order (closest along the route first). */
  order: number[];
  legKm: number[];
  /**
   * Direct road km from the airport to each stop (OSRM table service), indexed like `stops`.
   * Used for the fare split, so a rider isn't charged for detours made to drop others first.
   */
  stopKm: number[];
  totalKm: number;
  totalMin: number;
  /** [lat, lng] pairs for the map. */
  geometry: [number, number][];
  source: "osrm-trip" | "osrm-route" | "straight-line";
}

export interface OsrmDeps {
  fetch?: typeof fetch;
  /** Resolves when it's this request's turn (≤ 1 request/second across all servers). */
  throttle?: () => Promise<void>;
  cache?: { get(key: string): Promise<RoutePlan | null>; set(key: string, plan: RoutePlan): Promise<void> };
}

const coords = (pts: Point[]) => pts.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(";");

/** Same places in the same order → same key (5 decimals ≈ 1 m). */
export const cacheKey = (airport: Point, stops: Point[]) => `trip:${coords([airport, ...stops])}`;

function withStopKm(order: number[], legKm: number[], n: number) {
  const stopKm = new Array<number>(n).fill(0);
  let run = 0;
  order.forEach((stop, pos) => {
    run += legKm[pos] ?? 0;
    stopKm[stop] = run;
  });
  return stopKm;
}

/**
 * Best drop order from the airport (fixed start) to every stop, via OSRM's trip service
 * (source=first, roundtrip=false), so whoever is closest along the route is dropped first.
 */
export async function planDrops(airport: Point, stops: Point[], deps: OsrmDeps = {}): Promise<RoutePlan> {
  const key = cacheKey(airport, stops);
  const hit = await deps.cache?.get(key).catch(() => null);
  if (hit) return hit;

  const plan = await computeDrops(airport, stops, deps);
  // With one stop the route distance already is the direct distance.
  if (stops.length > 1 && plan.source !== "straight-line") {
    plan.stopKm = await directKm(airport, stops, deps).catch(() => plan.stopKm);
  }
  if (plan.source !== "straight-line") await deps.cache?.set(key, plan).catch(() => {});
  return plan;
}

async function osrmGet(path: string, deps: OsrmDeps) {
  await deps.throttle?.();
  const res = await (deps.fetch ?? fetch)(`${OSRM_URL}${path}`, {
    signal: AbortSignal.timeout(12_000),
    headers: { "user-agent": "Airpool/0.1 (hackathon cab-share app)" },
  });
  const data = await res.json();
  if (data.code !== "Ok") throw new Error(data.code ?? `HTTP ${res.status}`);
  return data;
}

/** One OSRM table request: road distance from the airport to every stop. */
async function directKm(airport: Point, stops: Point[], deps: OsrmDeps): Promise<number[]> {
  const data = await osrmGet(`/table/v1/driving/${coords([airport, ...stops])}?sources=0&annotations=distance`, deps);
  const row: (number | null)[] = data.distances[0].slice(1);
  if (row.length !== stops.length || row.some((d) => d == null)) throw new Error("incomplete table");
  return row.map((m) => (m as number) / 1000);
}

async function computeDrops(airport: Point, stops: Point[], deps: OsrmDeps): Promise<RoutePlan> {
  if (stops.length > 1) {
    try {
      const data = await osrmGet(
        `/trip/v1/driving/${coords([airport, ...stops])}?source=first&destination=any&roundtrip=false&overview=full&geometries=geojson`,
        deps,
      );
      const trip = data.trips[0];
      const order = (data.waypoints as { waypoint_index: number }[])
        .slice(1)
        .map((w, i) => ({ i, pos: w.waypoint_index }))
        .sort((a, b) => a.pos - b.pos)
        .map((x) => x.i);
      const legKm = trip.legs.map((l: { distance: number }) => l.distance / 1000);
      return {
        order,
        legKm,
        stopKm: withStopKm(order, legKm, stops.length),
        totalKm: trip.distance / 1000,
        totalMin: trip.duration / 60,
        geometry: trip.geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng]),
        source: "osrm-trip",
      };
    } catch (e) {
      console.warn("[osrm] trip failed, using nearest-first:", (e as Error).message);
    }
  }
  const order = stops.map((s, i) => ({ i, d: kmBetween(airport, s) })).sort((a, b) => a.d - b.d).map((x) => x.i);
  return route(airport, stops, order, deps);
}

async function route(airport: Point, stops: Point[], order: number[], deps: OsrmDeps): Promise<RoutePlan> {
  const ordered = [airport, ...order.map((i) => stops[i])];
  try {
    const data = await osrmGet(`/route/v1/driving/${coords(ordered)}?overview=full&geometries=geojson`, deps);
    const r = data.routes[0];
    const legKm = r.legs.map((l: { distance: number }) => l.distance / 1000);
    return {
      order,
      legKm,
      stopKm: withStopKm(order, legKm, stops.length),
      totalKm: r.distance / 1000,
      totalMin: r.duration / 60,
      geometry: r.geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng]),
      source: "osrm-route",
    };
  } catch {
    // OSRM unreachable: straight lines with a 1.3× road factor. Not cached, so it retries later.
    const legKm = ordered.slice(1).map((p, i) => kmBetween(ordered[i], p) * 1.3);
    const totalKm = legKm.reduce((a, b) => a + b, 0);
    return {
      order,
      legKm,
      stopKm: withStopKm(order, legKm, stops.length),
      totalKm,
      totalMin: (totalKm / 25) * 60,
      geometry: ordered.map((p) => [p.lat, p.lng]),
      source: "straight-line",
    };
  }
}
