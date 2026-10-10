import { AIRPORTS, type Airport } from "@/config/airports";
import { kmBetween } from "./geo";

export { AIRPORTS, type Airport };

export function airportByIata(iata?: string | null) {
  if (!iata) return undefined;
  return AIRPORTS.find((a) => a.iata === iata.toUpperCase());
}

/** Riders within this distance of an airport are treated as being at it. */
export const NEAR_AIRPORT_KM = 25;

/** Closest supported airport to a point, with its distance in km. */
export function nearestAirport(lat: number, lng: number) {
  let best = AIRPORTS[0];
  let bestKm = Infinity;
  for (const a of AIRPORTS) {
    const km = kmBetween({ lat, lng }, a);
    if (km < bestKm) {
      best = a;
      bestKm = km;
    }
  }
  return { airport: best, km: bestKm };
}
