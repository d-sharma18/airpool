import { MATCH_RULES, ZONES, type Zone } from "@/config/matching";
import { kmBetween } from "./geo";

export type Gender = "M" | "F" | "T";

/** Tier 1 = best. */
export type MatchTier = 1 | 2 | 3;
export type MatchType = "same_area" | "on_route" | "nearby_zone";

export const MATCH_LABEL: Record<MatchType, string> = {
  same_area: "Same area",
  on_route: "On your route",
  nearby_zone: "Nearby zone",
};

interface Point {
  lat: number;
  lng: number;
}

export interface Rider {
  verified: boolean;
  gender: Gender | null;
}

export interface MatchRequest extends Point, Rider {
  userId: string;
  airportIata: string;
  /** ISO timestamp. */
  arrivalAt: string;
  pax: number;
  flight: string | null;
  womenOnly: boolean;
}

export interface CandidateMember extends Point, Rider {
  userId: string;
  arrivalAt: string;
  pax: number;
  flight: string | null;
}

export interface CandidatePool {
  id: string;
  airportIata: string;
  status: string;
  womenOnly: boolean;
  maxPax: number;
  hostFirstName: string;
  members: CandidateMember[];
}

export interface Match {
  poolId: string;
  tier: MatchTier;
  type: MatchType;
  label: string;
  womenOnly: boolean;
  sameFlight: boolean;
  /** Furthest distance between your drop and any rider's drop. */
  maxKm: number;
  /** Largest gap between your landing time and any rider's. */
  maxWaitMin: number;
  seatsLeft: number;
  memberCount: number;
  hostFirstName: string;
  earliest: string;
  latest: string;
  /** Zone names of the group's drops (never exact addresses). */
  zones: string[];
  /** Your place in the drop order. Closer to the airport is dropped first. */
  dropPosition: number;
  groupSize: number;
}

/** Nearest named zone whose radius covers the point, or null when outside every zone. */
export function zoneFor(airportIata: string, p: Point): Zone | null {
  let best: Zone | null = null;
  let bestKm = Infinity;
  for (const z of ZONES[airportIata.toUpperCase()] ?? []) {
    const km = kmBetween(p, z);
    if (km <= z.radiusKm && km < bestKm) {
      best = z;
      bestKm = km;
    }
  }
  return best;
}

const minutesBetween = (a: string, b: string) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 60_000;

/** Why a pool was rejected. Useful in tests and debugging. */
export type Rejection =
  | "requester_unverified"
  | "not_open"
  | "different_airport"
  | "already_member"
  | "unverified_member"
  | "women_only_request"
  | "women_only_pool"
  | "full"
  | "arrival_window"
  | "too_far";

export function evaluate(
  req: MatchRequest,
  pool: CandidatePool,
  airport: Point,
): { match: Match } | { rejected: Rejection } {
  const R = MATCH_RULES;
  if (!req.verified) return { rejected: "requester_unverified" };
  if (pool.status !== "open") return { rejected: "not_open" };
  if (pool.airportIata.toUpperCase() !== req.airportIata.toUpperCase()) return { rejected: "different_airport" };
  if (pool.members.some((m) => m.userId === req.userId)) return { rejected: "already_member" };
  if (pool.members.length === 0 || pool.members.some((m) => !m.verified)) return { rejected: "unverified_member" };

  // Women-only: her request only meets women-only groups made of verified women,
  // and a women-only group never takes anyone else.
  const allWomen = pool.members.every((m) => m.gender === "F");
  if (req.womenOnly && !(pool.womenOnly && allWomen)) return { rejected: "women_only_request" };
  if (pool.womenOnly && req.gender !== "F") return { rejected: "women_only_pool" };

  const used = pool.members.reduce((s, m) => s + m.pax, 0);
  const capacity = Math.min(pool.maxPax, R.MAX_GROUP_SEATS);
  if (used + req.pax > capacity) return { rejected: "full" };

  const maxWaitMin = Math.max(...pool.members.map((m) => minutesBetween(m.arrivalAt, req.arrivalAt)));
  if (maxWaitMin > R.ARRIVAL_WINDOW_MIN) return { rejected: "arrival_window" };

  const maxKm = Math.max(...pool.members.map((m) => kmBetween(m, req)));
  if (maxKm > R.MAX_MATCH_KM) return { rejected: "too_far" };

  const myZone = zoneFor(req.airportIata, req);
  const theirZones = pool.members.map((m) => zoneFor(req.airportIata, m));
  // Outside every named zone, being within 2 km still counts as the same locality.
  const sameZone = theirZones.every((z) => (z?.id ?? null) === (myZone?.id ?? null));

  let tier: MatchTier;
  let type: MatchType;
  if (sameZone && maxKm <= R.SAME_AREA_KM) [tier, type] = [1, "same_area"];
  else if (maxKm <= R.ON_ROUTE_KM) [tier, type] = [2, "on_route"];
  else [tier, type] = [3, "nearby_zone"];

  // Drop order: closest to the airport gets out first.
  const fromAirport = (p: Point) => kmBetween(airport, p);
  const mine = fromAirport(req);
  const dropPosition = 1 + pool.members.filter((m) => fromAirport(m) < mine).length;

  const times = pool.members.map((m) => m.arrivalAt).sort();
  const flight = req.flight?.toUpperCase();

  return {
    match: {
      poolId: pool.id,
      tier,
      type,
      label: MATCH_LABEL[type],
      womenOnly: pool.womenOnly,
      sameFlight: !!flight && pool.members.some((m) => m.flight?.toUpperCase() === flight),
      maxKm: Math.round(maxKm * 10) / 10,
      maxWaitMin: Math.round(maxWaitMin),
      seatsLeft: capacity - used,
      memberCount: pool.members.length,
      hostFirstName: pool.hostFirstName,
      earliest: times[0],
      latest: times[times.length - 1],
      zones: [...new Set(theirZones.map((z) => z?.name ?? "Other area"))],
      dropPosition,
      groupSize: pool.members.length + 1,
    },
  };
}

/** Rank every compatible pool: best tier first, then same flight, shorter distance, shorter wait. */
export function findMatches(req: MatchRequest, pools: CandidatePool[], airport: Point): Match[] {
  return pools
    .map((p) => evaluate(req, p, airport))
    .flatMap((r) => ("match" in r ? [r.match] : []))
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        Number(b.sameFlight) - Number(a.sameFlight) ||
        a.maxKm - b.maxKm ||
        a.maxWaitMin - b.maxWaitMin,
    );
}
