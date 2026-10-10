"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect } from "react";
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";

export interface MapStop {
  lat: number;
  lng: number;
  label: string;
  /** Number shown on the pin (drop order). */
  n?: number;
  mine?: boolean;
}

// Standard OpenStreetMap tiles (free, no key), darkened with a CSS filter (.dark-tiles in globals.css).
// CARTO's dark basemap now needs an API key, so we don't use it.
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const ROUTE_ATTRIBUTION = `${ATTRIBUTION} · Routes &copy; <a href="https://project-osrm.org/">OSRM</a>`;

const pin = (text: string, bg: string, fg: string) =>
  L.divIcon({
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<div style="width:28px;height:28px;border-radius:9999px;background:${bg};color:${fg};display:grid;place-items:center;font:600 12px ui-monospace,monospace;border:2px solid #07090d;box-shadow:0 2px 8px rgba(0,0,0,.6)">${text}</div>`,
  });

function Fit({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [32, 32] });
    else if (points.length === 1) map.setView(points[0], 13);
  }, [map, points]);
  return null;
}

export default function MapView({
  airport,
  stops,
  route,
  className = "h-64",
}: {
  airport: { lat: number; lng: number; label: string };
  stops: MapStop[];
  route?: [number, number][];
  className?: string;
}) {
  const points: [number, number][] = [[airport.lat, airport.lng], ...stops.map((s) => [s.lat, s.lng] as [number, number])];
  return (
    <div className={`${className} overflow-hidden rounded-2xl border border-line`}>
      <MapContainer center={[airport.lat, airport.lng]} zoom={11} className="size-full" zoomControl={false} attributionControl>
        <TileLayer
          key={route && route.length > 1 ? "with-route" : "plain"}
          url={TILES}
          attribution={route && route.length > 1 ? ROUTE_ATTRIBUTION : ATTRIBUTION}
          maxZoom={19}
          className="dark-tiles"
        />
        {route && route.length > 1 && <Polyline positions={route} pathOptions={{ color: "#f5b83d", weight: 4, opacity: 0.9 }} />}
        <Marker position={[airport.lat, airport.lng]} icon={pin("✈", "#e8ecf2", "#07090d")}>
          <Tooltip>{airport.label}</Tooltip>
        </Marker>
        {stops.map((s, i) => (
          <Marker
            key={`${s.lat},${s.lng},${i}`}
            position={[s.lat, s.lng]}
            icon={pin(String(s.n ?? i + 1), s.mine ? "#f5b83d" : "#3a4456", s.mine ? "#1a1203" : "#e8ecf2")}
          >
            <Tooltip>{s.label}</Tooltip>
          </Marker>
        ))}
        <Fit points={points} />
      </MapContainer>
    </div>
  );
}
