// Zones are 5-character geohashes (~4.9 km × 4.9 km). A rider matches pools whose
// destinations fall in their zone or any of the 8 surrounding zones.

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
export const ZONE_PRECISION = 5;

export function encode(lat: number, lng: number, precision = ZONE_PRECISION): string {
  let latMin = -90, latMax = 90, lngMin = -180, lngMax = 180;
  let hash = "", bit = 0, ch = 0, even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) { ch = (ch << 1) | 1; lngMin = mid; } else { ch <<= 1; lngMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) { ch = (ch << 1) | 1; latMin = mid; } else { ch <<= 1; latMax = mid; }
    }
    even = !even;
    if (++bit === 5) { hash += BASE32[ch]; bit = 0; ch = 0; }
  }
  return hash;
}

function decodeBox(hash: string) {
  let latMin = -90, latMax = 90, lngMin = -180, lngMax = 180, even = true;
  for (const c of hash) {
    const v = BASE32.indexOf(c);
    for (let i = 4; i >= 0; i--) {
      const b = (v >> i) & 1;
      if (even) {
        const mid = (lngMin + lngMax) / 2;
        if (b) lngMin = mid; else lngMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (b) latMin = mid; else latMax = mid;
      }
      even = !even;
    }
  }
  return { latMin, latMax, lngMin, lngMax };
}

/** The zone itself plus its 8 neighbours. */
export function zoneWithNeighbours(lat: number, lng: number): string[] {
  const center = encode(lat, lng);
  const { latMin, latMax, lngMin, lngMax } = decodeBox(center);
  const dLat = latMax - latMin, dLng = lngMax - lngMin;
  const cLat = (latMin + latMax) / 2, cLng = (lngMin + lngMax) / 2;
  const zones = new Set<string>();
  for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) zones.add(encode(cLat + dy * dLat, cLng + dx * dLng));
  return [...zones];
}

export function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(r(b.lat - a.lat) / 2) ** 2 +
    Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
