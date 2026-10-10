"use client";

import { useEffect, useState } from "react";
import { AIRPORTS, NEAR_AIRPORT_KM, airportByIata, nearestAirport } from "@/lib/airports";
import { Button, Card, Label, Select, Spinner } from "./ui";

type Stage = "checking" | "ask" | "locating" | "detected" | "far" | "denied" | "unavailable" | "manual";

/**
 * Finds the rider's airport. Explains why before the browser's location prompt appears,
 * uses the position once on the device (never sent anywhere), and falls back to a dropdown.
 */
export default function AirportPicker({ value, onChange }: { value: string; onChange: (iata: string) => void }) {
  const [stage, setStage] = useState<Stage>("checking");
  const [farKm, setFarKm] = useState(0);
  const [detected, setDetected] = useState("");
  const airport = airportByIata(value);

  // If permission was already granted, detect straight away; if blocked, go to the dropdown.
  useEffect(() => {
    if (!("geolocation" in navigator)) return setStage("unavailable");
    if (!navigator.permissions?.query) return setStage("ask");
    navigator.permissions
      .query({ name: "geolocation" })
      .then((p) => {
        if (p.state === "granted") locate();
        else setStage(p.state === "denied" ? "denied" : "ask");
      })
      .catch(() => setStage("ask"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function locate() {
    setStage("locating");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const { airport: near, km } = nearestAirport(coords.latitude, coords.longitude);
        if (km <= NEAR_AIRPORT_KM) {
          onChange(near.iata);
          setDetected(near.iata);
          setStage("detected");
        } else {
          setFarKm(Math.round(km));
          setStage("far");
        }
      },
      (err) => setStage(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  }

  if (stage === "checking") {
    return <div className="h-[132px] animate-pulse rounded-2xl border border-line bg-surface" />;
  }

  if (stage === "ask") {
    return (
      <Card className="grid gap-3">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent/15 text-accent" aria-hidden>
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11Z" />
              <circle cx="12" cy="10" r="2.5" />
            </svg>
          </span>
          <div>
            <p className="font-semibold">Find your airport automatically?</p>
            <p className="mt-1 text-sm text-muted">
              We check your location once, on this phone, to see which airport you&apos;re at. It&apos;s never saved or
              shared.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={() => setStage("manual")}>
            Pick myself
          </Button>
          <Button onClick={locate}>Use location</Button>
        </div>
      </Card>
    );
  }

  if (stage === "locating") {
    return (
      <Card className="flex items-center gap-3 text-sm text-muted">
        <Spinner /> Finding the nearest airport…
      </Card>
    );
  }

  if (stage === "detected" && airport && detected === value) {
    return (
      <Card className="flex items-center justify-between gap-3 border-ok/30">
        <div>
          <p className="text-xs text-ok">✓ You&apos;re at</p>
          <p className="font-semibold">{airport.name}</p>
          <p className="font-mono text-xs text-muted">
            {airport.iata} · {airport.city}
          </p>
        </div>
        <button type="button" className="text-sm text-muted underline" onClick={() => setStage("manual")}>
          Change
        </button>
      </Card>
    );
  }

  const note = {
    far: `You're about ${farKm} km from the nearest airport we cover. Pick the airport you're landing at.`,
    denied: "Location is off for Airpool. No problem, just pick your airport.",
    unavailable: "We couldn't get your location. Pick your airport below.",
    manual: null,
  }[stage as "far" | "denied" | "unavailable" | "manual"];

  return (
    <Card className="grid gap-3">
      {note && <p className="text-sm text-muted">{note}</p>}
      <label>
        <Label>Landing at</Label>
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          {AIRPORTS.map((a) => (
            <option key={a.iata} value={a.iata}>
              {a.iata} · {a.city}: {a.name}
            </option>
          ))}
        </Select>
      </label>
      {stage !== "denied" && stage !== "unavailable" && (
        <button type="button" className="justify-self-start text-sm text-accent underline" onClick={locate}>
          Use my location instead
        </button>
      )}
    </Card>
  );
}
