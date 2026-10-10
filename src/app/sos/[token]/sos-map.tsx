"use client";

import Map from "@/components/map";

export default function SosMap({
  lat,
  lng,
  label,
  airport,
}: {
  lat: number;
  lng: number;
  label: string;
  airport: { lat: number; lng: number; name: string } | null;
}) {
  return (
    <Map
      airport={airport ? { lat: airport.lat, lng: airport.lng, label: airport.name } : { lat, lng, label }}
      stops={[{ lat, lng, label: `${label} (live)`, mine: true, n: 1 }]}
      className="h-72"
    />
  );
}
