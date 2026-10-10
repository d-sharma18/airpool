/**
 * Matching configuration. To add a city, add its airport to src/config/airports.ts and its
 * neighbourhoods to ZONES below. Nothing else needs to change.
 *
 * The database mirrors ARRIVAL_WINDOW_MIN, MAX_MATCH_KM and MAX_GROUP_SEATS as a safety net in
 * supabase/migrations/0001_init.sql (join_pool and guard_pool_member). Keep them in sync.
 */

export const MATCH_RULES = {
  /** Everyone in a group must land within this many minutes of each other. */
  ARRIVAL_WINDOW_MIN: 45,
  /** Tier 1, "Same area": same named zone and drops within this distance. */
  SAME_AREA_KM: 2,
  /** Tier 2, "On your route": drops within this distance, any zone. */
  ON_ROUTE_KM: 5,
  /** Tier 3, "Nearby zone": drops within this distance. Nothing further apart is matched. */
  MAX_MATCH_KM: 7,
  /** Seats in the largest car we book (SUV / Innova). A group never exceeds this. */
  MAX_GROUP_SEATS: 6,
  /** How long a women-only group waits before we ask the host what to do. */
  WOMEN_ONLY_WAIT_MIN: 15,
} as const;

export interface Zone {
  /** Stable id, stored in the database. Don't rename once in use. */
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** A drop belongs to the nearest zone whose centre is within this radius. */
  radiusKm: number;
}

/**
 * Named neighbourhoods per airport (IATA code). Centres are approximate. Adjust them freely.
 * Drops outside every zone still match by distance (tiers 2 and 3).
 */
export const ZONES: Record<string, Zone[]> = {
  JAI: [
    { id: "jai-mansarovar", name: "Mansarovar", lat: 26.8686, lng: 75.757, radiusKm: 3 },
    { id: "jai-malviya-nagar", name: "Malviya Nagar", lat: 26.8536, lng: 75.8155, radiusKm: 2.5 },
    { id: "jai-jagatpura", name: "Jagatpura", lat: 26.827, lng: 75.859, radiusKm: 3 },
    { id: "jai-vaishali-nagar", name: "Vaishali Nagar", lat: 26.912, lng: 75.743, radiusKm: 3 },
    { id: "jai-c-scheme", name: "C Scheme", lat: 26.911, lng: 75.8, radiusKm: 2 },
    { id: "jai-raja-park", name: "Raja Park", lat: 26.899, lng: 75.829, radiusKm: 2 },
    { id: "jai-tonk-road", name: "Tonk Road", lat: 26.847, lng: 75.803, radiusKm: 2 },
    { id: "jai-sitapura", name: "Sitapura", lat: 26.778, lng: 75.847, radiusKm: 3 },
  ],
};
