"use client";

import { useEffect, useRef, useState } from "react";
import { Input, Spinner } from "./ui";

export interface Place {
  label: string;
  lat: number;
  lng: number;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: Record<string, string | undefined>;
}

function labelOf(p: PhotonFeature["properties"]) {
  const first = [p.name, p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street].filter(Boolean)[0];
  return [first, p.district ?? p.locality, p.city ?? p.county, p.state]
    .filter((x, i, a) => x && a.indexOf(x) === i)
    .join(", ");
}

/** Address autocomplete via Photon (komoot), biased to the airport's city and bounded to India. */
export default function PlaceSearch({
  near,
  value,
  onSelect,
}: {
  near?: { lat: number; lng: number };
  value: Place | null;
  onSelect: (p: Place | null) => void;
}) {
  const [q, setQ] = useState(value?.label ?? "");
  const [results, setResults] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    if (q.trim().length < 3 || q === value?.label) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      ctrl.current?.abort();
      ctrl.current = new AbortController();
      setLoading(true);
      try {
        const params = new URLSearchParams({ q, limit: "6", lang: "en", bbox: "68,6,98,37" });
        if (near) {
          params.set("lat", String(near.lat));
          params.set("lon", String(near.lng));
        }
        const res = await fetch(`https://photon.komoot.io/api/?${params}`, { signal: ctrl.current.signal });
        const data = (await res.json()) as { features: PhotonFeature[] };
        setResults(
          data.features.map((f) => ({
            label: labelOf(f.properties),
            lng: f.geometry.coordinates[0],
            lat: f.geometry.coordinates[1],
          })),
        );
        setOpen(true);
      } catch {
        /* aborted or offline */
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, near, value?.label]);

  return (
    <div className="relative">
      <Input
        value={q}
        placeholder="Area, building or landmark"
        onChange={(e) => {
          setQ(e.target.value);
          if (value) onSelect(null);
        }}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {loading && (
        <span className="absolute right-3 top-4 text-muted">
          <Spinner />
        </span>
      )}
      {open && results.length > 0 && (
        <ul className="absolute z-[1100] mt-1 max-h-72 w-full overflow-auto rounded-xl border border-line bg-surface-2 shadow-2xl">
          {results.map((r, i) => (
            <li key={`${r.lat},${r.lng},${i}`}>
              <button
                type="button"
                className="w-full px-3.5 py-3 text-left text-sm hover:bg-line"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setQ(r.label);
                  setOpen(false);
                  onSelect(r);
                }}
              >
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
