"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Map from "@/components/map";
import { useToast } from "@/components/toaster";
import { Badge, Button, Card, ErrorNote, Spinner, buttonClass, cx } from "@/components/ui";
import { airportByIata } from "@/lib/airports";
import { OSRM_ATTRIBUTION } from "@/lib/osrm";
import { firstName, fmtDay, fmtTime, inr } from "@/lib/format";
import { formatCarNumber } from "@/lib/booking";
import { dropArea, groupMessage } from "@/lib/share";
import { createClient } from "@/lib/supabase/client";
import type { Pool, PoolMember, PoolPlan } from "@/lib/types";
import ContactsCard from "./contacts-card";
import MeetingPoint from "./meeting-point";
import PoolChat from "./pool-chat";
import RideFeedback from "./ride-feedback";
import SosButton from "./sos-button";
import VehicleCard from "./vehicle-card";
import WomenOnlyWait from "./women-only-wait";

export interface Person {
  id: string;
  name: string | null;
  gender: string | null;
  verified: boolean;
  signature_ok: boolean;
  avatar_path: string | null;
  avatar_url?: string | null;
  upi_id: string | null;
  is_demo?: boolean;
}
export interface Contact {
  user_id: string;
  name: string | null;
  phone: string | null;
  phone_verified: boolean;
}
export interface Message {
  id: number;
  user_id: string;
  body: string;
  created_at: string;
}

const SOURCE_LABEL = { gemini: "Gemini estimate", groq: "Groq estimate", rules: "Rate-card estimate", actual: "Final fare" } as const;

export default function PoolView({
  me,
  pool,
  members,
  people,
  contacts,
  initialMessages,
  notifyOnMatch,
  myConfirmation = null,
}: {
  me: string;
  pool: Pool;
  members: PoolMember[];
  people: Person[];
  contacts: Contact[];
  initialMessages: Message[];
  notifyOnMatch: boolean;
  /** My answer to "was everyone a woman?" for this ride, if given. */
  myConfirmation?: boolean | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const toast = useToast();
  const airport = airportByIata(pool.airport_iata)!;
  const isHost = pool.created_by === me;
  const person = useCallback((id: string) => people.find((p) => p.id === id), [people]);

  const [plan, setPlan] = useState<PoolPlan | null>(pool.plan);
  const [planBusy, setPlanBusy] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => setPlan(pool.plan), [pool.plan]);

  const computePlan = useCallback(
    async () => {
      setPlanBusy(true);
      const res = await fetch("/api/pool-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ poolId: pool.id }),
      }).catch(() => null);
      const body = res ? await res.json().catch(() => ({})) : {};
      setPlanBusy(false);
      if (res?.ok) setPlan(body);
      else toast(body.error ?? (navigator.onLine ? "Couldn't plan the route. Tap refresh to retry." : "You're offline. We'll plan the route when you're back."), "error");
    },
    [pool.id, toast],
  );

  // A join or leave clears the plan; whoever is looking recomputes it.
  useEffect(() => {
    if (!pool.plan && pool.status !== "cancelled") computePlan();
  }, [pool.plan, pool.status, computePlan]);

  // Live updates: riders joining/leaving, host locking, plan changes.
  useEffect(() => {
    const ch = supabase
      .channel(`pool-meta:${pool.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "pool_members", filter: `pool_id=eq.${pool.id}` }, () =>
        router.refresh(),
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pools", filter: `id=eq.${pool.id}` }, () =>
        router.refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [supabase, pool.id, router]);

  // Announce live changes pushed by Realtime (a rider joining or leaving, the group locking).
  const prev = useRef({ ids: members.map((m) => m.user_id), status: pool.status });
  useEffect(() => {
    const before = prev.current;
    for (const m of members) {
      if (!before.ids.includes(m.user_id) && m.user_id !== me) {
        const msg = `${firstName(person(m.user_id)?.name)} joined your Airpool group`;
        toast(msg, "success");
        // Also a system notification if they allowed it and the app is in the background.
        if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
          new Notification("Airpool", { body: msg });
        }
      }
    }
    if (members.length < before.ids.length) toast("A rider left the group. Everyone needs to accept again");
    if (before.status === "open" && pool.status === "locked") toast("Group locked. Names and numbers are now shared", "success");
    prev.current = { ids: members.map((m) => m.user_id), status: pool.status };
  }, [members, pool.status, me, person, toast]);

  async function rpc(name: string, args: Record<string, unknown>, after?: () => void) {
    setBusy(name);
    setError("");
    const { error } = await supabase.rpc(name, args);
    setBusy("");
    if (error) {
      toast(error.message, "error");
      return setError(error.message);
    }
    if (name === "accept_pool") toast("You accepted. Waiting for the others", "success");
    if (name === "set_pool_status") toast(args.p_status === "completed" ? "Ride marked as done" : "Group updated", "success");
    after?.();
    router.refresh();
  }

  const order = plan?.drop_order ?? members.map((m) => m.user_id);
  const ordered = order.map((id) => members.find((m) => m.user_id === id)).filter((m): m is PoolMember => !!m);
  const myShare = plan?.shares.find((s) => s.user_id === me);
  const seatsUsed = members.reduce((s, m) => s + m.pax, 0);
  const locked = pool.status === "locked" || pool.status === "completed";
  const mine = members.find((m) => m.user_id === me);
  const acceptedCount = members.filter((m) => m.accepted).length;
  const capacity = Math.min(pool.max_pax, 6);
  const area = (m: PoolMember) => dropArea(pool.airport_iata, m.dest_zone, m.dest_label);
  // Full verified names only after lock (get_pool_contacts returns nothing before).
  const displayName = (id: string) => (locked ? contacts.find((c) => c.user_id === id)?.name : null) ?? firstName(person(id)?.name);

  // Used by WhatsApp/family sharing (after lock) and SOS (any time). Phones only exist after lock.
  const shareText = groupMessage({
    airportName: airport.name,
    airportIata: airport.iata,
    day: fmtDay(members[0]?.arrival_at ?? pool.created_at),
    car: plan ? plan.vehicle : null,
    meeting: pool.meeting_point ? { point: pool.meeting_point, note: pool.meeting_note } : null,
    riders: ordered.map((m) => ({
      name: displayName(m.user_id),
      phone: contacts.find((c) => c.user_id === m.user_id)?.phone ?? null,
      flight: m.flight_iata,
      landsAt: m.arrival_at,
      area: area(m),
    })),
    cab: pool.car_number ? { number: formatCarNumber(pool.car_number), driver: pool.driver_name, model: pool.car_model } : null,
  });

  return (
    <div className="grid grid-cols-1 gap-4 pb-6">
      <section>
        <p className="font-mono text-xs text-muted">
          {airport.iata} · {fmtDay(members[0]?.arrival_at ?? pool.created_at)}
        </p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Your {airport.city} group</h1>
          <Badge tone={pool.status === "open" ? "accent" : pool.status === "locked" ? "ok" : "muted"}>
            {pool.status === "open" ? "forming" : pool.status}
          </Badge>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {pool.women_only && <Badge tone="women">Women only</Badge>}
          <Badge>
            {seatsUsed}/{capacity} seats
          </Badge>
          {plan && (
            <Badge>
              {plan.total_km} km · {plan.total_min} min
            </Badge>
          )}
        </div>
      </section>

      {pool.status === "open" && (
        <Card className="grid grid-cols-1 gap-3 border-accent/30">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">
              {acceptedCount} of {members.length} accepted
            </p>
            <div className="flex gap-1" aria-hidden>
              {members.map((m) => (
                <span key={m.user_id} className={cx("size-2.5 rounded-full", m.accepted ? "bg-ok" : "bg-line")} />
              ))}
            </div>
          </div>
          <p className="text-sm text-muted">
            {members.length < 2
              ? "Waiting for someone to join. You'll see them appear here live."
              : `The group locks when everyone accepts or all ${capacity} seats fill up. Then everyone sees full names and phone numbers.`}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {mine?.accepted ? (
              <span className={cx(buttonClass("ghost"), "pointer-events-none text-ok")}>✓ You accepted</span>
            ) : (
              <Button onClick={() => rpc("accept_pool", { p_pool: pool.id })} disabled={!!busy || members.length < 2}>
                {busy === "accept_pool" && <Spinner />} Accept
              </Button>
            )}
            <Button
              variant="outline"
              disabled={!!busy}
              onClick={() => {
                if (confirm("Leave this group?")) rpc("leave_pool", { p_pool: pool.id }, () => router.push("/dashboard"));
              }}
            >
              Leave
            </Button>
          </div>
        </Card>
      )}

      {pool.status === "open" && members.length === 1 && !pool.women_only && <NotifyMe />}

      {isHost && pool.women_only && pool.status === "open" && (
        <WomenOnlyWait
          poolId={pool.id}
          createdAt={pool.created_at}
          waitUntil={pool.women_wait_until}
          alone={members.length === 1}
          notify={notifyOnMatch}
          memberCount={members.length}
          onChanged={() => router.refresh()}
        />
      )}

      <Map
        airport={{ lat: airport.lat, lng: airport.lng, label: airport.name }}
        stops={ordered.map((m, i) => ({
          lat: m.dest_lat,
          lng: m.dest_lng,
          label: `${i + 1}. ${displayName(m.user_id)}: ${area(m)}`,
          n: i + 1,
          mine: m.user_id === me,
        }))}
        route={plan?.geometry}
      />

      {/* Riders in drop order */}
      <Card className="grid grid-cols-1 gap-3">
        <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Riders · drop order</h2>
        {ordered.map((m, i) => {
          const p = person(m.user_id);
          const share = plan?.shares.find((s) => s.user_id === m.user_id);
          return (
            <div key={m.user_id} className="flex items-center gap-3">
              <span className="w-5 font-mono text-sm text-muted">{i + 1}</span>
              {p?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.avatar_url} alt="" className="size-10 rounded-full object-cover" />
              ) : (
                <span className="grid size-10 place-items-center rounded-full bg-surface-2 font-semibold">
                  {firstName(p?.name)[0]}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 font-medium">
                  <span className="truncate">{displayName(m.user_id)}</span>
                  {m.user_id === me && <span className="text-xs text-muted">(you)</span>}
                  {p?.verified && <Badge tone="ok">✓ Verified</Badge>}
                  {p?.is_demo && <Badge>Demo</Badge>}
                  {m.user_id === pool.created_by && <Badge tone="accent">host</Badge>}
                </p>
                <p className="text-xs text-muted">
                  Drop-off: <span className="text-ink">{area(m)}</span>
                  {share && <> · {share.km} km by road</>} · lands {fmtTime(m.arrival_at)}
                  {m.flight_iata && ` · ${m.flight_iata}`}
                </p>
                <p className="text-xs text-muted">
                  {m.pax} {m.pax === 1 ? "person" : "people"} · 🧳 {m.checked_bags} check-in · {m.cabin_bags} cabin
                  {pool.status === "open" && (
                    <span className={cx("ml-1.5", m.accepted ? "text-ok" : "text-muted")}>
                      · {m.accepted ? "accepted" : "deciding"}
                    </span>
                  )}
                </p>
              </div>
              {share && (
                <div className="text-right">
                  <p className="font-mono text-sm">{inr(share.amount)}</p>
                  {!plan?.final && <p className="text-[10px] text-muted">estimate</p>}
                  {pool.booked_at && m.user_id !== pool.booker_id && (
                    <p className={cx("text-xs", m.paid ? "text-ok" : "text-muted")}>{m.paid ? "paid ✓" : "unpaid"}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <p className="text-[11px] text-muted">
          {plan?.route_source === "straight-line"
            ? "Routing service unavailable. Order and distances are approximate."
            : `Drop order and road distances: ${OSRM_ATTRIBUTION}`}
        </p>
      </Card>

      {/* AI vehicle + fare */}
      <Card className="grid grid-cols-1 gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Ride plan</h2>
          <button className="text-xs text-muted underline" onClick={() => computePlan()} disabled={planBusy}>
            {planBusy ? "planning…" : "refresh"}
          </button>
        </div>
        {!plan && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> Working out the car, route and split…
          </p>
        )}
        {plan && (
          <>
            <VehicleCard v={plan.vehicle} />
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs text-muted">{SOURCE_LABEL[plan.fare_source]}</p>
                <p className="font-mono text-2xl">{inr(plan.fare_total)}</p>
              </div>
              {myShare && (
                <div className="text-right">
                  <p className="text-xs text-muted">
                    Your share{!plan.final && " (est.)"} · {myShare.km} km
                  </p>
                  <p className="font-mono text-2xl text-accent">{inr(myShare.amount)}</p>
                </div>
              )}
            </div>
            <p className="text-xs text-muted">
              {plan.final
                ? plan.split_method === "ai"
                  ? "Split calculated by AI and checked against the distance formula."
                  : plan.split_note ?? "Split by road distance from the airport."
                : `${plan.fare_note} Shares follow each rider's road distance from the airport. The booker enters the real fare after the ride.`}
            </p>
            <Link href={`/pool/${pool.id}/fare`} className={buttonClass("ghost", true)}>
              See fare breakdown
            </Link>
          </>
        )}
      </Card>


      {locked && (
        <Link href={`/pool/${pool.id}/book`} className="block">
          <Card className="flex items-center justify-between gap-3 border-accent/50 bg-accent/5 transition hover:border-accent">
            <div>
              <p className="font-semibold">{pool.booked_at ? "Cab booked · payments" : "Book the cab"}</p>
              <p className="text-sm text-muted">
                {pool.booked_at
                  ? `${pool.car_model || "Car"} ${pool.car_number ?? ""} · driver ${pool.driver_name}`
                  : "Pick a booker, open Uber or Ola, then share the driver details."}
              </p>
            </div>
            <span className="text-accent" aria-hidden>
              →
            </span>
          </Card>
        </Link>
      )}

      {(pool.status === "open" || pool.status === "locked") && (
        <MeetingPoint
          poolId={pool.id}
          point={pool.meeting_point}
          note={pool.meeting_note}
          editable
          onSaved={() => router.refresh()}
        />
      )}

      {/* Safety: names and numbers only after lock */}
      {locked ? (
        <ContactsCard me={me} contacts={contacts} message={shareText} />
      ) : (
        <Card className="text-sm text-muted">
          🔒 Full names and phone numbers appear here once everyone accepts or the car is full. Until then, use the group
          chat below.
        </Card>
      )}
      <SosButton poolId={pool.id} details={shareText} />

      {locked && (
        <RideFeedback
          poolId={pool.id}
          womenOnly={pool.women_only}
          completed={pool.status === "completed"}
          confirmed={myConfirmation}
          riders={members.filter((m) => m.user_id !== me).map((m) => ({ id: m.user_id, name: displayName(m.user_id) }))}
          onDone={() => router.refresh()}
        />
      )}

      <ErrorNote>{error}</ErrorNote>

      {pool.status === "locked" && (
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            disabled={!!busy}
            onClick={() => {
              if (confirm("Leave this locked group? It will reopen for everyone else.")) {
                rpc("leave_pool", { p_pool: pool.id }, () => router.push("/dashboard"));
              }
            }}
          >
            Leave group
          </Button>
          {isHost ? (
            <Button onClick={() => rpc("set_pool_status", { p_pool: pool.id, p_status: "completed" })} disabled={!!busy}>
              Ride done
            </Button>
          ) : (
            <span />
          )}
        </div>
      )}

      <PoolChat poolId={pool.id} me={me} people={people} initial={initialMessages} />
    </div>
  );
}

/** Asks for notification permission so a join can alert the rider while the app is in the background. */
function NotifyMe() {
  const toast = useToast();
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  useEffect(() => setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission), []);

  if (perm === "unsupported") return null;
  return (
    <Card className="grid grid-cols-1 gap-2 text-center">
      <p className="text-3xl" aria-hidden>
        🛬
      </p>
      <p className="font-semibold">No one on your flight yet</p>
      <p className="text-sm text-muted">
        Your group is visible to verified riders landing near your time and heading your way. Keep this page open.
      </p>
      {perm === "granted" ? (
        <p className="text-sm text-ok">✓ We&apos;ll notify you the moment someone joins.</p>
      ) : perm === "denied" ? (
        <p className="text-xs text-muted">Notifications are blocked in your browser settings. You&apos;ll still see joins here.</p>
      ) : (
        <Button
          variant="ghost"
          full
          onClick={async () => {
            const p = await Notification.requestPermission().catch(() => "denied" as const);
            setPerm(p);
            if (p === "granted") toast("We'll notify you when someone joins", "success");
          }}
        >
          🔔 Notify me when someone joins
        </Button>
      )}
    </Card>
  );
}
