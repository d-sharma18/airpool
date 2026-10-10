import { ZONES } from "@/config/matching";
import type { MeetingPoint } from "./types";

export const MEETING_POINTS: Record<MeetingPoint, { label: string; hint: string }> = {
  arrival_gate: { label: "Arrival gate", hint: "Just outside the arrivals exit" },
  pickup_zone: { label: "App-cab pickup zone", hint: "Where Uber / Ola pick up" },
  parking: { label: "Parking / pickup lane", hint: "Outside, by the car park" },
  other: { label: "Somewhere else", hint: "Describe it below" },
};

/** Drop-off area to show before a group locks: the named zone, else the locality, never the street address. */
export function dropArea(airportIata: string, zoneId: string | null, label: string) {
  const zone = (ZONES[airportIata.toUpperCase()] ?? []).find((z) => z.id === zoneId);
  if (zone) return zone.name;
  const parts = label.split(",").map((p) => p.trim()).filter(Boolean);
  return parts[1] ?? parts[0] ?? "Drop-off";
}

/** "9876543210" → "+91 98765 43210" */
export const formatPhone = (p: string) => `+91 ${p.slice(0, 5)} ${p.slice(5)}`;

export interface ShareRider {
  name: string;
  phone: string | null;
  flight: string | null;
  landsAt: string;
  area: string;
}

export interface ShareDetails {
  airportName: string;
  airportIata: string;
  day: string;
  car: { label: string; uber: string; ola: string } | null;
  /** Filled in once the booker has booked. */
  cab?: { number: string; driver: string | null; model: string | null } | null;
  meeting: { point: MeetingPoint; note: string | null } | null;
  /** In drop order. */
  riders: ShareRider[];
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });

/** Plain-text group details for WhatsApp or the share sheet: names, phones, flights, route and car. */
export function groupMessage(d: ShareDetails) {
  const lines = [
    `🚕 Airpool shared cab · ${d.airportName} (${d.airportIata}) · ${d.day}`,
    "",
    "✈️ Flights",
    ...d.riders.map((r) => `• ${r.flight ?? "Flight"} → ${d.airportIata}, lands ${fmtTime(r.landsAt)} (${r.name.split(" ")[0]})`),
    "",
    `🗺️ Route: ${d.airportIata} airport → ${d.riders.map((r) => r.area).join(" → ")}`,
  ];
  if (d.cab) {
    lines.push(`🚙 Cab: ${d.cab.model ? `${d.cab.model} ` : ""}${d.cab.number}${d.cab.driver ? `, driver ${d.cab.driver}` : ""}`);
  } else if (d.car) {
    lines.push(`🚙 Car: ${d.car.label} (${d.car.uber} / ${d.car.ola})`);
  }
  if (d.meeting) {
    lines.push(`📍 Meeting point: ${MEETING_POINTS[d.meeting.point].label}${d.meeting.note ? `: ${d.meeting.note}` : ""}`);
  }
  lines.push(
    "",
    "👥 Riders (Aadhaar-verified)",
    ...d.riders.map((r, i) => `${i + 1}. ${r.name}${r.phone ? ` · ${formatPhone(r.phone)}` : ""} · drop: ${r.area}`),
    "",
    "Emergency: 112",
  );
  return lines.join("\n");
}

export const whatsappLink = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
