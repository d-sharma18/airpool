import { describe, expect, it, vi } from "vitest";
import { cacheKey, planDrops, type RoutePlan } from "./osrm";

const JAI = { lat: 26.8242, lng: 75.8122 };
const stops = [
  { lat: 26.8686, lng: 75.757 }, // 0: Mansarovar (far)
  { lat: 26.847, lng: 75.803 }, // 1: Tonk Road (near)
  { lat: 26.8536, lng: 75.8155 }, // 2: Malviya Nagar (middle)
];

// OSRM trip answer: drops Tonk Road, then Malviya Nagar, then Mansarovar.
const tripResponse = {
  code: "Ok",
  waypoints: [{ waypoint_index: 0 }, { waypoint_index: 3 }, { waypoint_index: 1 }, { waypoint_index: 2 }],
  trips: [{
    distance: 15_000,
    duration: 1800,
    legs: [{ distance: 4000 }, { distance: 3000 }, { distance: 8000 }],
    geometry: { coordinates: [[75.8122, 26.8242], [75.757, 26.8686]] },
  }],
};

// OSRM table answer: direct road km from the airport (like the real Jaipur numbers).
const tableResponse = { code: "Ok", distances: [[0, 10200, 6300, 8300]] };

function fakeFetch(body: unknown = tripResponse) {
  return vi.fn<(url: string) => Promise<Response>>(async (url) =>
    new Response(JSON.stringify(String(url).includes("/table/") ? tableResponse : body)),
  );
}

describe("planDrops", () => {
  it("asks OSRM trip with the airport as the fixed start and no return", async () => {
    const f = fakeFetch();
    await planDrops(JAI, stops, { fetch: f as unknown as typeof fetch });
    const url = String(f.mock.calls[0][0]);
    expect(url).toContain("/trip/v1/driving/75.81220,26.82420;");
    expect(url).toContain("source=first");
    expect(url).toContain("roundtrip=false");
    expect(url).toContain("destination=any");
  });

  it("returns OSRM's drop order and each stop's direct road km from the airport", async () => {
    const f = fakeFetch();
    const plan = await planDrops(JAI, stops, { fetch: f as unknown as typeof fetch });
    expect(plan.order).toEqual([1, 2, 0]); // Tonk Road, Malviya Nagar, Mansarovar
    // Direct distances, not distance along the trip, so nobody pays for others' detours.
    expect(plan.stopKm).toEqual([10.2, 6.3, 8.3]);
    expect(plan.source).toBe("osrm-trip");
    expect(String(f.mock.calls[1][0])).toContain("/table/v1/driving/75.81220,26.82420;");
    expect(String(f.mock.calls[1][0])).toContain("sources=0&annotations=distance");
  });

  it("falls back to distance along the route if the table request fails", async () => {
    const f = vi.fn<(url: string) => Promise<Response>>(async (url) =>
      new Response(JSON.stringify(String(url).includes("/table/") ? { code: "NoTable" } : tripResponse)),
    );
    const plan = await planDrops(JAI, stops, { fetch: f as unknown as typeof fetch });
    expect(plan.stopKm).toEqual([15, 4, 7]); // cumulative
  });

  it("waits for the throttle before every request", async () => {
    const order: string[] = [];
    const throttle = vi.fn(async () => void order.push("throttle"));
    const f = vi.fn(async () => (order.push("fetch"), new Response(JSON.stringify(tripResponse))));
    await planDrops(JAI, stops, { fetch: f as unknown as typeof fetch, throttle });
    expect(order).toEqual(["throttle", "fetch", "throttle", "fetch"]); // trip, then table
  });

  it("uses the cache and skips OSRM on a hit", async () => {
    const store = new Map<string, RoutePlan>();
    const cache = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, p: RoutePlan) => void store.set(k, p) };
    const f = fakeFetch();
    const a = await planDrops(JAI, stops, { fetch: f as unknown as typeof fetch, cache });
    const b = await planDrops(JAI, stops, { fetch: f as unknown as typeof fetch, cache });
    expect(f).toHaveBeenCalledTimes(2); // trip + table, once
    expect(b).toEqual(a);
    expect(store.has(cacheKey(JAI, stops))).toBe(true);
  });

  it("doesn't cache the straight-line fallback when OSRM is down", async () => {
    const store = new Map<string, RoutePlan>();
    const cache = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, p: RoutePlan) => void store.set(k, p) };
    const down = vi.fn(async () => { throw new Error("offline"); });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const plan = await planDrops(JAI, stops, { fetch: down as unknown as typeof fetch, cache });
    expect(plan.source).toBe("straight-line");
    expect(plan.order).toEqual([1, 2, 0]); // nearest-first
    expect(store.size).toBe(0);
  });

  it("uses the route service for a single stop", async () => {
    const f = fakeFetch({ code: "Ok", routes: [{ distance: 9000, duration: 900, legs: [{ distance: 9000 }], geometry: { coordinates: [] } }] });
    const plan = await planDrops(JAI, [stops[0]], { fetch: f as unknown as typeof fetch });
    expect(String(f.mock.calls[0][0])).toContain("/route/v1/driving/");
    expect(plan.stopKm).toEqual([9]);
  });
});
