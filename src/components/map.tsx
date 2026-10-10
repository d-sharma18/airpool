"use client";

import dynamic from "next/dynamic";

/** Leaflet touches `window`, so the map only renders on the client. */
const Map = dynamic(() => import("./map-view"), {
  ssr: false,
  loading: () => <div className="h-64 animate-pulse rounded-2xl border border-line bg-surface" />,
});

export default Map;
export type { MapStop } from "./map-view";
