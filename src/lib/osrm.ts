import { kmBetween } from "./geohash";

const OSRM = "https://router.project-osrm.org";

export interface Point {
  lat: number;
  lng: number;
}

export interface RoutePlan {
  /** Indices into `stops`, in the order they should be dropped. */
  order: number[];
  legKm: number[];
  totalKm: number;
  totalMin: number;
  geometry: [number, number][];
}

const coords = (pts: Point[]) => pts.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");

/** Best drop order from the airport to every stop, using OSRM's trip (TSP) service. */
export async function planDrops(airport: Point, stops: Point[]): Promise<RoutePlan> {
  try {
    if (stops.length === 1) return await route(airport, stops, [0]);
    const res = await fetch(
      `${OSRM}/trip/v1/driving/${coords([airport, ...stops])}?source=first&destination=any&roundtrip=false&overview=full&geometries=geojson`,
      { signal: AbortSignal.timeout(12_000) },
    );
    const data = await res.json();
    if (data.code !== "Ok") throw new Error(data.code);
    const trip = data.trips[0];
    const order = (data.waypoints as { waypoint_index: number }[])
      .slice(1)
      .map((w, i) => ({ i, pos: w.waypoint_index }))
      .sort((a, b) => a.pos - b.pos)
      .map((x) => x.i);
    return {
      order,
      legKm: trip.legs.map((l: { distance: number }) => l.distance / 1000),
      totalKm: trip.distance / 1000,
      totalMin: trip.duration / 60,
      geometry: trip.geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng]),
    };
  } catch (e) {
    console.warn("[osrm] trip failed, using nearest-first:", (e as Error).message);
    const order = stops.map((s, i) => ({ i, d: kmBetween(airport, s) })).sort((a, b) => a.d - b.d).map((x) => x.i);
    return route(airport, stops, order);
  }
}

async function route(airport: Point, stops: Point[], order: number[]): Promise<RoutePlan> {
  const ordered = [airport, ...order.map((i) => stops[i])];
  try {
    const res = await fetch(`${OSRM}/route/v1/driving/${coords(ordered)}?overview=full&geometries=geojson`, {
      signal: AbortSignal.timeout(12_000),
    });
    const data = await res.json();
    if (data.code !== "Ok") throw new Error(data.code);
    const r = data.routes[0];
    return {
      order,
      legKm: r.legs.map((l: { distance: number }) => l.distance / 1000),
      totalKm: r.distance / 1000,
      totalMin: r.duration / 60,
      geometry: r.geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng]),
    };
  } catch {
    // OSRM unreachable: straight lines with a 1.3× road factor.
    const legKm = ordered.slice(1).map((p, i) => kmBetween(ordered[i], p) * 1.3);
    const totalKm = legKm.reduce((a, b) => a + b, 0);
    return { order, legKm, totalKm, totalMin: (totalKm / 25) * 60, geometry: ordered.map((p) => [p.lat, p.lng]) };
  }
}
