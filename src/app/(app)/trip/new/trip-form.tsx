"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import AirportPicker from "@/components/airport-picker";
import Map from "@/components/map";
import PlaceSearch, { type Place } from "@/components/place-search";
import { useToast } from "@/components/toaster";
import { Badge, Button, Card, ErrorNote, Field, Input, Spinner, Stepper, cx } from "@/components/ui";
import { airportByIata } from "@/lib/airports";
import { recommendVehicleByRules } from "@/lib/vehicle";
import { MATCH_RULES } from "@/config/matching";
import { fmtTime } from "@/lib/format";
import { zoneFor, type Match } from "@/lib/matching";
import { createClient } from "@/lib/supabase/client";
import type { FlightInfo, PreferredCar } from "@/lib/types";
import { normalizeFlight, validateFlight } from "@/lib/validation";

const todayIst = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const CARS: { value: PreferredCar; label: string; hint: string }[] = [
  { value: "any", label: "Any", hint: "Best fit" },
  { value: "mini", label: "Mini", hint: "Small boot" },
  { value: "sedan", label: "Sedan", hint: "Big boot" },
  { value: "suv", label: "SUV", hint: "6 seats" },
];

type Errors = Partial<Record<"flight" | "date" | "time" | "dest", string | null>>;

export default function TripForm({ canWomenOnly }: { canWomenOnly: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const toast = useToast();
  const timeRef = useRef<HTMLInputElement>(null);

  const [flight, setFlight] = useState("");
  const [date, setDate] = useState(todayIst());
  const [time, setTime] = useState("");
  const [arrivalSource, setArrivalSource] = useState<"aviationstack" | "manual">("manual");
  const [flightInfo, setFlightInfo] = useState<FlightInfo | null>(null);
  const [lookupNote, setLookupNote] = useState("");
  const [airportIata, setAirportIata] = useState("JAI");
  const [dest, setDest] = useState<Place | null>(null);
  const [pax, setPax] = useState(1);
  const [checked, setChecked] = useState(1);
  const [cabin, setCabin] = useState(1);
  const [car, setCar] = useState<PreferredCar>("any");
  const [womenOnly, setWomenOnly] = useState(false);
  const [maxPax, setMaxPax] = useState(4);

  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);

  const airport = airportByIata(airportIata)!;
  const near = useMemo(() => ({ lat: airport.lat, lng: airport.lng }), [airport]);
  const arrivalIso = time ? `${date}T${time}:00+05:30` : "";
  const fit = recommendVehicleByRules([{ pax, cabin, checked }]);
  const destZone = dest ? zoneFor(airportIata, dest) : null;
  const wantsWomenOnly = canWomenOnly && womenOnly;

  // Any edit after saving means the saved request no longer matches the form.
  const touch = () => {
    setMatches(null);
  };

  async function lookup() {
    const flightErr = validateFlight(flight);
    setErrors((e) => ({ ...e, flight: flightErr }));
    if (flightErr) return;
    setBusy("lookup");
    setLookupNote("");
    setFlightInfo(null);
    const res = await fetch(`/api/flight?flight=${encodeURIComponent(normalizeFlight(flight))}&date=${date}`).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy("");

    if (!res?.ok) {
      setLookupNote(body.error ?? "Flight lookup is unavailable right now. Enter your arrival time below.");
      setArrivalSource("manual");
      timeRef.current?.focus();
      return;
    }
    const info = body as FlightInfo;
    setFlightInfo(info);
    if (info.arrival_iata && airportByIata(info.arrival_iata)) setAirportIata(info.arrival_iata);
    else if (info.arrival_iata) setLookupNote(`${info.arrival_iata} isn't covered yet. Pick the nearest airport above.`);
    const at = info.estimated_arrival ?? info.scheduled_arrival;
    if (at) {
      setDate(at.slice(0, 10));
      setTime(at.slice(11, 16));
      setArrivalSource("aviationstack");
      setErrors((e) => ({ ...e, time: null }));
    } else {
      setLookupNote("Found the flight, but not its arrival time. Enter it below.");
      timeRef.current?.focus();
    }
    touch();
  }

  function validate(): Errors {
    const e: Errors = {
      flight: validateFlight(flight),
      date: date ? null : "Pick your arrival date.",
      time: time ? null : "Enter your arrival time, or look up your flight.",
      dest: dest ? null : "Search and pick your destination from the list.",
    };
    if (!e.date && !e.time && new Date(arrivalIso).getTime() < Date.now() - 3 * 3600_000) {
      e.time = "That arrival time is in the past.";
    }
    return e;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.values(found).some(Boolean)) return setError("Fix the highlighted fields.");
    setError("");
    setBusy("save");

    // Re-saving replaces the earlier search instead of leaving duplicates behind.
    if (requestId) await supabase.from("trip_requests").update({ status: "cancelled" }).eq("id", requestId);

    const { data: saved, error: saveErr } = await supabase
      .from("trip_requests")
      .insert({
        flight_iata: normalizeFlight(flight),
        arrival_date: date,
        arrival_at: arrivalIso,
        arrival_source: arrivalSource,
        airport_iata: airportIata,
        dest_label: dest!.label,
        dest_lat: dest!.lat,
        dest_lng: dest!.lng,
        zone: destZone?.id ?? "other",
        pax,
        checked_bags: checked,
        cabin_bags: cabin,
        preferred_car: car,
        women_only: wantsWomenOnly,
      })
      .select("id")
      .single();
    if (saveErr) {
      setBusy("");
      return setError(saveErr.message);
    }
    setRequestId(saved.id);
    setMaxPax(car === "suv" ? 6 : 4);

    const res = await fetch("/api/matches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: saved.id }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy("");
    if (!res?.ok) return setError(body.error ?? "Couldn't search for co-riders. Try again.");
    toast("Trip saved. Searching for co-riders", "success");
    setMatches(body.matches as Match[]);
  }

  async function join(poolId: string) {
    setBusy(poolId);
    setError("");
    const { error } = await supabase.rpc("join_pool", { p_pool: poolId, p_request: requestId });
    if (error) {
      setBusy("");
      return setError(error.message);
    }
    router.push(`/pool/${poolId}`);
  }

  async function create() {
    setBusy("create");
    setError("");
    const { data, error } = await supabase.rpc("create_pool", { p_request: requestId, p_max_pax: maxPax });
    if (error) {
      setBusy("");
      return setError(error.message);
    }
    router.push(`/pool/${data}`);
  }

  const heading = "font-mono text-xs uppercase tracking-[0.2em] text-muted";

  return (
    <div className="mt-5 grid gap-4">
      <form onSubmit={save} noValidate className="grid gap-4" onChange={touch}>
        <AirportPicker value={airportIata} onChange={(v) => (setAirportIata(v), touch())} />

        <Card className="grid gap-4">
          <p className={heading}>Flight</p>
          <Field id="flight" label="Flight number" error={errors.flight}>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Input
                id="flight"
                value={flight}
                invalid={!!errors.flight}
                placeholder="6E2134"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={9}
                onChange={(e) => {
                  setFlight(e.target.value.toUpperCase());
                  setFlightInfo(null);
                  if (errors.flight) setErrors((x) => ({ ...x, flight: null }));
                }}
                onBlur={() => flight && setErrors((x) => ({ ...x, flight: validateFlight(flight) }))}
              />
              <Button type="button" variant="ghost" onClick={lookup} disabled={!flight || busy === "lookup"}>
                {busy === "lookup" ? <Spinner /> : "Look up"}
              </Button>
            </div>
          </Field>

          {flightInfo && (
            <div className="rounded-xl bg-surface-2 px-3 py-2 text-sm">
              <p>
                <span className="font-semibold">{flightInfo.airline ?? flightInfo.flight_iata}</span>{" "}
                <span className="text-muted">
                  {flightInfo.departure_iata} → {flightInfo.arrival_iata}
                  {flightInfo.terminal && ` · T${flightInfo.terminal}`}
                </span>
              </p>
              {flightInfo.status && <p className="text-xs capitalize text-muted">{flightInfo.status}</p>}
            </div>
          )}
          {lookupNote && <p className="rounded-xl bg-accent/10 px-3 py-2 text-sm text-accent">{lookupNote}</p>}

          <div className="grid grid-cols-2 gap-2">
            <Field id="date" label="Arrival date" error={errors.date}>
              <Input
                id="date"
                type="date"
                min={todayIst()}
                value={date}
                invalid={!!errors.date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setFlightInfo(null);
                }}
              />
            </Field>
            <Field
              id="time"
              label="Arrival time"
              hint={arrivalSource === "aviationstack" ? "from flight" : "IST"}
              error={errors.time}
            >
              <Input
                id="time"
                ref={timeRef}
                type="time"
                value={time}
                invalid={!!errors.time}
                onChange={(e) => {
                  setTime(e.target.value);
                  setArrivalSource("manual");
                  if (errors.time) setErrors((x) => ({ ...x, time: null }));
                }}
              />
            </Field>
          </div>
        </Card>

        <Card className="grid gap-4">
          <p className={heading}>Going to · {airport.city}</p>
          <Field id="dest" label="Destination" error={errors.dest}>
            <PlaceSearch
              id="dest"
              invalid={!!errors.dest}
              near={near}
              value={dest}
              onSelect={(p) => {
                setDest(p);
                touch();
                if (p) setErrors((x) => ({ ...x, dest: null }));
              }}
            />
          </Field>
          {dest && (
            <p className="-mt-2 text-xs text-muted">
              Zone: <span className="text-ink">{destZone?.name ?? "Outside our named zones (matched by distance)"}</span>
            </p>
          )}
          <Map
            airport={{ ...near, label: airport.name }}
            stops={dest ? [{ ...dest, label: dest.label, mine: true, n: 1 }] : []}
            className="h-48"
          />
        </Card>

        <Card className="grid gap-3">
          <p className={heading}>Your group</p>
          <Stepper label="People (incl. you)" value={pax} onChange={(n) => (setPax(n), touch())} min={1} max={4} />
          <Stepper label="Check-in bags" value={checked} onChange={(n) => (setChecked(n), touch())} min={0} max={8} />
          <Stepper label="Cabin bags" value={cabin} onChange={(n) => (setCabin(n), touch())} min={0} max={8} />

          <div>
            <p className="mb-1.5 text-sm font-medium text-muted">Preferred car</p>
            <div role="radiogroup" aria-label="Preferred car" className="grid grid-cols-4 gap-1.5">
              {CARS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={car === c.value}
                  onClick={() => (setCar(c.value), touch())}
                  className={cx(
                    "rounded-xl border px-1 py-2 text-center",
                    car === c.value ? "border-accent bg-accent/10 text-accent" : "border-line text-ink",
                  )}
                >
                  <span className="block text-sm font-semibold">{c.label}</span>
                  <span className="block truncate text-[10px] text-muted">{c.hint}</span>
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-muted">
              Your group alone needs at least: {fit.label}.
              {car === "mini" && fit.vehicle !== "mini" && " A mini may be too small for these bags."}
            </p>
          </div>

          {canWomenOnly && (
            <label className="flex items-center justify-between gap-3 rounded-xl border border-women/30 bg-women/5 px-3 py-3">
              <span>
                <span className="font-medium text-women">Women-only ride</span>
                <span className="block text-xs text-muted">Match only with verified women</span>
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
        <Button type="submit" full disabled={busy === "save"}>
          {busy === "save" && <Spinner />} {matches ? "Update & search again" : "Save & find co-riders"}
        </Button>
      </form>

      {matches && (
        <section className="grid gap-3 pb-4">
          <h2 className={heading}>
            {matches.length ? `${matches.length} group${matches.length > 1 ? "s" : ""} going your way` : "No groups yet"}
          </h2>

          {matches.length === 0 && wantsWomenOnly && (
            <p className="rounded-xl border border-women/30 bg-women/5 px-3 py-2.5 text-sm text-muted">
              No women-only groups yet. Start one below. If no woman joins within {MATCH_RULES.WOMEN_ONLY_WAIT_MIN}{" "}
              minutes, we&apos;ll ask whether you want to keep waiting, get notified, or open it to everyone.
            </p>
          )}

          {matches.map((m) => (
            <Card key={m.poolId} className="grid gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone={m.tier === 1 ? "ok" : "accent"}>{m.label}</Badge>
                    {m.womenOnly && <Badge tone="women">Women only</Badge>}
                    {m.sameFlight && <Badge tone="accent">Same flight</Badge>}
                  </div>
                  <p className="mt-2 font-semibold">{m.hostFirstName}&apos;s group</p>
                  <p className="truncate text-xs text-muted">Going to {m.zones.join(", ")}</p>
                </div>
                <span className="shrink-0 font-mono text-sm text-accent">
                  {m.seatsLeft} seat{m.seatsLeft > 1 ? "s" : ""}
                </span>
              </div>
              <dl className="grid grid-cols-3 gap-2 rounded-xl bg-surface-2 p-2.5 text-center text-xs">
                <div>
                  <dt className="text-muted">Lands</dt>
                  <dd className="font-mono">
                    {fmtTime(m.earliest)}
                    {m.latest !== m.earliest && `–${fmtTime(m.latest)}`}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Drops apart</dt>
                  <dd className="font-mono">≤ {m.maxKm} km</dd>
                </div>
                <div>
                  <dt className="text-muted">You&apos;re dropped</dt>
                  <dd className="font-mono">
                    {m.dropPosition} of {m.groupSize}
                  </dd>
                </div>
              </dl>
              <Button full onClick={() => join(m.poolId)} disabled={!!busy}>
                {busy === m.poolId && <Spinner />} Join · {m.memberCount} verified rider{m.memberCount > 1 ? "s" : ""}
              </Button>
            </Card>
          ))}

          <Card className={cx("grid gap-3", matches.length === 0 && "border-accent/40")}>
            {matches.length ? (
              <p className="font-semibold">None of these fit?</p>
            ) : (
              <div className="grid gap-1 text-center">
                <p className="text-3xl" aria-hidden>
                  🛬
                </p>
                <p className="font-semibold">No one on your flight yet</p>
              </div>
            )}
            <p className={cx("text-sm text-muted", !matches.length && "text-center")}>
              {matches.length
                ? `Start your own group instead. Riders landing within ${MATCH_RULES.ARRIVAL_WINDOW_MIN} minutes of you and heading your way can join.`
                : `Start a group and we'll notify you the moment someone landing within ${MATCH_RULES.ARRIVAL_WINDOW_MIN} minutes of you, heading your way, joins.`}
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
              {busy === "create" && <Spinner />} Start a {wantsWomenOnly ? "women-only " : ""}group
            </Button>
          </Card>
        </section>
      )}
    </div>
  );
}
