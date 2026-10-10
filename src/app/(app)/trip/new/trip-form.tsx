"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import Map from "@/components/map";
import PlaceSearch, { type Place } from "@/components/place-search";
import { Badge, Button, Card, ErrorNote, Input, Label, Select, Spinner, Stepper, cx } from "@/components/ui";
import { AIRPORTS, airportByIata } from "@/lib/airports";
import { recommendVehicleByRules } from "@/lib/fare";
import { fmtTime } from "@/lib/format";
import { encode, zoneWithNeighbours } from "@/lib/geohash";
import { createClient } from "@/lib/supabase/client";
import type { FlightInfo, PoolMatch } from "@/lib/types";

const todayIst = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

export default function TripForm({ canWomenOnly }: { canWomenOnly: boolean }) {
  const supabase = createClient();
  const router = useRouter();

  const [flight, setFlight] = useState("");
  const [date, setDate] = useState(todayIst());
  const [flightInfo, setFlightInfo] = useState<FlightInfo | null>(null);
  const [lookupMsg, setLookupMsg] = useState("");
  const [airportIata, setAirportIata] = useState("BLR");
  const [time, setTime] = useState("");
  const [dest, setDest] = useState<Place | null>(null);
  const [pax, setPax] = useState(1);
  const [checked, setChecked] = useState(1);
  const [cabin, setCabin] = useState(1);
  const [womenOnly, setWomenOnly] = useState(false);
  const [maxPax, setMaxPax] = useState(4);

  const [busy, setBusy] = useState<"" | "lookup" | "search" | "create" | string>("");
  const [error, setError] = useState("");
  const [matches, setMatches] = useState<PoolMatch[] | null>(null);

  const airport = airportByIata(airportIata)!;
  const near = useMemo(() => ({ lat: airport.lat, lng: airport.lng }), [airport]);
  const arrivalIso = time ? `${date}T${time}:00+05:30` : "";
  const myLoad = recommendVehicleByRules({ pax, cabin, checked });

  async function lookup() {
    setBusy("lookup");
    setLookupMsg("");
    setFlightInfo(null);
    const res = await fetch(`/api/flight?flight=${encodeURIComponent(flight)}&date=${date}`);
    const body = await res.json();
    setBusy("");
    if (!res.ok) return setLookupMsg(body.error);
    const info = body as FlightInfo;
    setFlightInfo(info);
    if (info.arrival_iata && airportByIata(info.arrival_iata)) setAirportIata(info.arrival_iata);
    else if (info.arrival_iata) setLookupMsg(`${info.arrival_iata} isn't supported yet. Pick the nearest airport.`);
    const at = info.estimated_arrival ?? info.scheduled_arrival;
    if (at) {
      setDate(at.slice(0, 10));
      setTime(at.slice(11, 16));
    }
  }

  function ready() {
    if (!time) return "Add your arrival time.";
    if (!dest) return "Pick your destination from the suggestions.";
    if (new Date(arrivalIso).getTime() < Date.now() - 3 * 3600_000) return "That arrival time is in the past.";
    return "";
  }

  async function search(e: React.FormEvent) {
    e.preventDefault();
    const problem = ready();
    if (problem) return setError(problem);
    setError("");
    setBusy("search");
    const { data, error } = await supabase.rpc("find_pools", {
      p_airport: airportIata,
      p_zones: zoneWithNeighbours(dest!.lat, dest!.lng),
      p_arrival: arrivalIso,
      p_lat: dest!.lat,
      p_lng: dest!.lng,
      p_pax: pax,
      p_flight: flight.toUpperCase(),
    });
    setBusy("");
    if (error) return setError(error.message);
    setMatches(((data ?? []) as PoolMatch[]).filter((m) => !womenOnly || m.women_only));
  }

  const tripArgs = () => ({
    p_flight: flight.toUpperCase(),
    p_arrival: arrivalIso,
    p_dest_label: dest!.label,
    p_lat: dest!.lat,
    p_lng: dest!.lng,
    p_pax: pax,
    p_cabin: cabin,
    p_checked: checked,
  });

  async function join(poolId: string) {
    setBusy(poolId);
    setError("");
    const { error } = await supabase.rpc("join_pool", {
      p_pool: poolId,
      p_zone: encode(dest!.lat, dest!.lng),
      ...tripArgs(),
    });
    if (error) {
      setBusy("");
      return setError(error.message);
    }
    router.push(`/pool/${poolId}`);
  }

  async function create() {
    setBusy("create");
    setError("");
    const { data, error } = await supabase.rpc("create_pool", {
      p_airport: airportIata,
      p_zone: encode(dest!.lat, dest!.lng),
      p_women_only: womenOnly,
      p_max_pax: Math.max(maxPax, pax + 1),
      ...tripArgs(),
    });
    if (error) {
      setBusy("");
      return setError(error.message);
    }
    router.push(`/pool/${data}`);
  }

  return (
    <div className="mt-5 grid gap-4">
      <form onSubmit={search} className="grid gap-4">
        <Card className="grid gap-4">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Flight</p>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <label>
              <Label>Flight number</Label>
              <Input
                value={flight}
                onChange={(e) => setFlight(e.target.value.toUpperCase())}
                placeholder="6E 2134"
                autoCapitalize="characters"
              />
            </label>
            <Button type="button" variant="ghost" className="mt-[26px]" onClick={lookup} disabled={!flight || busy === "lookup"}>
              {busy === "lookup" ? <Spinner /> : "Look up"}
            </Button>
          </div>
          {flightInfo && (
            <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm">
              <span className="font-semibold">{flightInfo.airline ?? flightInfo.flight_iata}</span>{" "}
              <span className="text-muted">
                {flightInfo.departure_iata} → {flightInfo.arrival_iata}
                {flightInfo.terminal && ` · T${flightInfo.terminal}`}
                {flightInfo.status && ` · ${flightInfo.status}`}
              </span>
            </p>
          )}
          {lookupMsg && <p className="text-sm text-muted">{lookupMsg}</p>}

          <label>
            <Label>Landing at</Label>
            <Select value={airportIata} onChange={(e) => setAirportIata(e.target.value)}>
              {AIRPORTS.map((a) => (
                <option key={a.iata} value={a.iata}>
                  {a.iata} · {a.city}
                </option>
              ))}
            </Select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label>
              <Label>Date</Label>
              <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label>
              <Label>Arrival (IST)</Label>
              <Input type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
          </div>
        </Card>

        <Card className="grid gap-4">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Going to</p>
          <PlaceSearch near={near} value={dest} onSelect={setDest} />
          <Map
            airport={{ ...near, label: airport.name }}
            stops={dest ? [{ ...dest, label: dest.label, mine: true, n: 1 }] : []}
            className="h-48"
          />
        </Card>

        <Card className="grid gap-3">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">You and your bags</p>
          <Stepper label="People (incl. you)" value={pax} onChange={setPax} min={1} max={4} />
          <Stepper label="Checked suitcases" value={checked} onChange={setChecked} min={0} max={8} />
          <Stepper label="Cabin bags" value={cabin} onChange={setCabin} min={0} max={8} />
          <p className="text-xs text-muted">On your own you&apos;d need: {myLoad.label}.</p>
          {canWomenOnly && (
            <label className="flex items-center justify-between rounded-xl border border-women/30 bg-women/5 px-3 py-3">
              <span>
                <span className="font-medium text-women">Women-only pool</span>
                <span className="block text-xs text-muted">Only verified women can see or join</span>
              </span>
              <input
                type="checkbox"
                className="size-5 accent-[#d8a4ff]"
                checked={womenOnly}
                onChange={(e) => setWomenOnly(e.target.checked)}
              />
            </label>
          )}
        </Card>

        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" full disabled={busy === "search"}>
          {busy === "search" && <Spinner />} Find co-riders
        </Button>
      </form>

      {matches && (
        <section className="grid gap-3 pb-4">
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
            {matches.length ? `${matches.length} pool${matches.length > 1 ? "s" : ""} going your way` : "No pools yet"}
          </h2>
          {matches.map((m) => {
            const seatsLeft = m.max_pax - m.pax_used;
            return (
              <Card key={m.pool_id} className="grid gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{m.creator_first_name}&apos;s pool</p>
                    <p className="font-mono text-xs text-muted">
                      Lands {fmtTime(m.earliest)}
                      {m.latest !== m.earliest && `–${fmtTime(m.latest)}`} · drop {m.nearest_km} km from yours
                    </p>
                  </div>
                  <span className="font-mono text-sm text-accent">{seatsLeft} seat{seatsLeft > 1 ? "s" : ""}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {m.same_flight && <Badge tone="accent">Same flight</Badge>}
                  {m.women_only && <Badge tone="women">Women only</Badge>}
                  <Badge>
                    {m.member_count} verified rider{m.member_count > 1 ? "s" : ""}
                  </Badge>
                </div>
                <Button full onClick={() => join(m.pool_id)} disabled={!!busy}>
                  {busy === m.pool_id && <Spinner />} Join pool
                </Button>
              </Card>
            );
          })}

          <Card className={cx("grid gap-3", matches.length === 0 && "border-accent/40")}>
            <p className="font-semibold">{matches.length ? "None of these fit?" : "Be the first"}</p>
            <p className="text-sm text-muted">
              Start a pool. Riders landing within an hour of you and heading your way will see it.
            </p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {[4, 6].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMaxPax(n)}
                  className={cx(
                    "h-11 rounded-xl border",
                    maxPax === n ? "border-accent bg-accent/10 text-accent" : "border-line text-muted",
                  )}
                >
                  {n === 4 ? "Car · up to 4" : "SUV · up to 6"}
                </button>
              ))}
            </div>
            <Button full variant={matches.length ? "ghost" : "primary"} onClick={create} disabled={!!busy}>
              {busy === "create" && <Spinner />} Start a {womenOnly ? "women-only " : ""}pool
            </Button>
          </Card>
        </section>
      )}
    </div>
  );
}
