"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import Map from "@/components/map";
import { Badge, Button, Card, ErrorNote, Input, Spinner, buttonClass, cx } from "@/components/ui";
import { airportByIata } from "@/lib/airports";
import { olaLink, uberLink, upiLink } from "@/lib/deeplinks";
import { firstName, fmtDay, fmtTime, inr } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import type { Pool, PoolMember, PoolPlan } from "@/lib/types";
import PoolChat from "./pool-chat";

export interface Person {
  id: string;
  full_name: string | null;
  gender: string | null;
  aadhaar_verified: boolean;
  aadhaar_signature_ok: boolean;
  avatar_path: string | null;
  avatar_url?: string | null;
  upi_id: string | null;
}
export interface Contact {
  user_id: string;
  full_name: string | null;
  phone: string | null;
  phone_verified: boolean;
}
export interface Message {
  id: number;
  user_id: string;
  body: string;
  created_at: string;
}

const SOURCE_LABEL = { gemini: "Gemini", groq: "Groq", rules: "Rate card", actual: "Actual fare" } as const;

export default function PoolView({
  me,
  pool,
  members,
  people,
  contacts,
  initialMessages,
}: {
  me: string;
  pool: Pool;
  members: PoolMember[];
  people: Person[];
  contacts: Contact[];
  initialMessages: Message[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const airport = airportByIata(pool.airport_iata)!;
  const isHost = pool.created_by === me;
  const person = useCallback((id: string) => people.find((p) => p.id === id), [people]);
  const host = person(pool.created_by);

  const [plan, setPlan] = useState<PoolPlan | null>(pool.plan);
  const [planBusy, setPlanBusy] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [actualFare, setActualFare] = useState("");

  useEffect(() => setPlan(pool.plan), [pool.plan]);

  const computePlan = useCallback(
    async (fare?: number) => {
      setPlanBusy(true);
      const res = await fetch("/api/pool-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ poolId: pool.id, actualFare: fare }),
      });
      const body = await res.json();
      setPlanBusy(false);
      if (res.ok) setPlan(body);
      else setError(body.error ?? "Couldn't plan the route");
    },
    [pool.id],
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

  async function rpc(name: string, args: Record<string, unknown>, after?: () => void) {
    setBusy(name);
    setError("");
    const { error } = await supabase.rpc(name, args);
    setBusy("");
    if (error) return setError(error.message);
    after?.();
    router.refresh();
  }

  const order = plan?.drop_order ?? members.map((m) => m.user_id);
  const ordered = order.map((id) => members.find((m) => m.user_id === id)).filter((m): m is PoolMember => !!m);
  const finalDrop = ordered.at(-1);
  const myShare = plan?.shares.find((s) => s.user_id === me);
  const seatsUsed = members.reduce((s, m) => s + m.pax, 0);
  const locked = pool.status === "locked" || pool.status === "completed";
  const pickup = { lat: airport.lat, lng: airport.lng, name: `${airport.iata} Airport` };

  return (
    <div className="grid gap-4 pb-6">
      <section>
        <p className="font-mono text-xs text-muted">
          {airport.iata} · {fmtDay(members[0]?.arrival_at ?? pool.created_at)}
        </p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{airport.city} pool</h1>
          <Badge tone={pool.status === "open" ? "accent" : pool.status === "locked" ? "ok" : "muted"}>{pool.status}</Badge>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {pool.women_only && <Badge tone="women">Women only</Badge>}
          <Badge>
            {seatsUsed}/{pool.max_pax} seats
          </Badge>
          {plan && (
            <Badge>
              {plan.total_km} km · {plan.total_min} min
            </Badge>
          )}
        </div>
      </section>

      <Map
        airport={{ lat: airport.lat, lng: airport.lng, label: airport.name }}
        stops={ordered.map((m, i) => ({
          lat: m.dest_lat,
          lng: m.dest_lng,
          label: `${i + 1}. ${firstName(person(m.user_id)?.full_name)}: ${m.dest_label}`,
          n: i + 1,
          mine: m.user_id === me,
        }))}
        route={plan?.geometry}
      />

      {/* Riders in drop order */}
      <Card className="grid gap-3">
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
                  {firstName(p?.full_name)[0]}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate font-medium">
                  {firstName(p?.full_name)}
                  {m.user_id === me && <span className="text-xs text-muted">(you)</span>}
                  {m.user_id === pool.created_by && <Badge tone="accent">host</Badge>}
                  {p?.aadhaar_verified && <span className="text-ok" title="Aadhaar verified">✓</span>}
                </p>
                <p className="truncate text-xs text-muted">
                  {m.dest_label.split(",").slice(0, 2).join(",")} · lands {fmtTime(m.arrival_at)}
                  {m.flight_iata && ` · ${m.flight_iata}`}
                </p>
                <p className="text-xs text-muted">
                  {m.pax} pax · {m.checked_bags} checked · {m.cabin_bags} cabin
                </p>
              </div>
              {share && (
                <div className="text-right">
                  <p className="font-mono text-sm">{inr(share.amount)}</p>
                  {m.user_id !== pool.created_by &&
                    (isHost ? (
                      <button
                        className={cx("text-xs", m.paid ? "text-ok" : "text-muted underline")}
                        onClick={() => rpc("set_member_paid", { p_pool: pool.id, p_user: m.user_id, p_paid: !m.paid })}
                      >
                        {m.paid ? "paid ✓" : "mark paid"}
                      </button>
                    ) : (
                      <p className={cx("text-xs", m.paid ? "text-ok" : "text-muted")}>{m.paid ? "paid ✓" : "unpaid"}</p>
                    ))}
                </div>
              )}
            </div>
          );
        })}
      </Card>

      {/* AI vehicle + fare */}
      <Card className="grid gap-3">
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
            <div className="rounded-xl bg-surface-2 p-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold">{plan.vehicle.label}</p>
                <Badge tone="accent">AI · {SOURCE_LABEL[plan.vehicle.source]}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted">
                {plan.vehicle.uber} / {plan.vehicle.ola} · {plan.vehicle.seats} seats
              </p>
              <p className="mt-2 text-sm">{plan.vehicle.reason}</p>
            </div>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs text-muted">
                  Total fare · {SOURCE_LABEL[plan.fare_source]}
                  {plan.fare_source !== "actual" && " estimate"}
                </p>
                <p className="font-mono text-2xl">{inr(plan.fare_total)}</p>
              </div>
              {myShare && (
                <div className="text-right">
                  <p className="text-xs text-muted">Your share · {myShare.km} km</p>
                  <p className="font-mono text-2xl text-accent">{inr(myShare.amount)}</p>
                </div>
              )}
            </div>
            <p className="text-xs text-muted">
              {plan.fare_note} Each leg is shared by whoever is still in the cab, so you only pay for the distance you
              ride.
            </p>
            {isHost && (
              <form
                className="grid grid-cols-[1fr_auto] gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const n = Number(actualFare);
                  if (n > 0) computePlan(n).then(() => setActualFare(""));
                }}
              >
                <Input
                  inputMode="numeric"
                  placeholder="Actual fare paid (₹)"
                  value={actualFare}
                  onChange={(e) => setActualFare(e.target.value.replace(/\D/g, ""))}
                />
                <Button variant="ghost" type="submit" disabled={!actualFare || planBusy}>
                  Re-split
                </Button>
              </form>
            )}
          </>
        )}
      </Card>

      {/* Booking */}
      {isHost && finalDrop && (
        <Card className="grid gap-3">
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Book the cab</h2>
          <div className="grid grid-cols-2 gap-2">
            <a
              className={buttonClass("ghost")}
              href={uberLink(pickup, { lat: finalDrop.dest_lat, lng: finalDrop.dest_lng, name: finalDrop.dest_label.split(",")[0] })}
              target="_blank"
              rel="noreferrer"
            >
              Open Uber
            </a>
            <a
              className={buttonClass("ghost")}
              href={olaLink(pickup, { lat: finalDrop.dest_lat, lng: finalDrop.dest_lng, name: finalDrop.dest_label.split(",")[0] })}
              target="_blank"
              rel="noreferrer"
            >
              Open Ola
            </a>
          </div>
          {ordered.length > 1 && (
            <p className="text-xs text-muted">
              Final drop is pre-filled. Add stops in the app in this order:{" "}
              {ordered
                .slice(0, -1)
                .map((m) => m.dest_label.split(",")[0])
                .join(" → ")}
              .
            </p>
          )}
          {plan && <p className="text-xs text-muted">Choose {plan.vehicle.uber} on Uber or {plan.vehicle.ola} on Ola.</p>}
        </Card>
      )}

      {/* Payment */}
      {!isHost && myShare && (
        <Card className="grid gap-3">
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Pay the host</h2>
          {host?.upi_id ? (
            <>
              <a
                className={buttonClass("primary", true)}
                href={upiLink(host.upi_id, host.full_name ?? "Airpool host", myShare.amount, `Airpool ${airport.iata} cab share`)}
              >
                Pay {inr(myShare.amount)} via UPI
              </a>
              <p className="text-center text-xs text-muted">
                to {host.upi_id} · opens GPay, PhonePe, Paytm or BHIM
              </p>
            </>
          ) : (
            <p className="text-sm text-muted">{firstName(host?.full_name)} hasn&apos;t added a UPI ID yet. Ask in the chat.</p>
          )}
        </Card>
      )}
      {isHost && !host?.upi_id && members.length > 1 && (
        <Card className="border-accent/40 text-sm">
          Add your UPI ID in{" "}
          <a href="/profile" className="text-accent underline">
            Profile
          </a>{" "}
          so riders can pay you back in one tap.
        </Card>
      )}

      {/* Safety */}
      <Card className="grid gap-3">
        <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Safety</h2>
        {locked ? (
          <div className="grid gap-2">
            {contacts
              .filter((c) => c.user_id !== me)
              .map((c) => (
                <div key={c.user_id} className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2.5">
                  <div>
                    <p className="font-medium">{firstName(c.full_name)}</p>
                    <p className="font-mono text-sm text-muted">
                      {c.phone ?? "no number"}
                      {c.phone_verified && <span className="ml-1.5 text-xs text-ok">matches Aadhaar</span>}
                    </p>
                  </div>
                  {c.phone && (
                    <a href={`tel:+91${c.phone}`} className={buttonClass("ghost")}>
                      Call
                    </a>
                  )}
                </div>
              ))}
          </div>
        ) : (
          <p className="text-sm text-muted">
            🔒 Phone numbers unlock for everyone once the host locks the group. Until then, use the chat below.
          </p>
        )}
        <a href="tel:112" className={buttonClass("danger", true)}>
          Emergency · call 112
        </a>
      </Card>

      <ErrorNote>{error}</ErrorNote>

      {/* Host controls */}
      <div className="grid gap-2">
        {isHost && pool.status === "open" && (
          <Button full onClick={() => rpc("set_pool_status", { p_pool: pool.id, p_status: "locked" })} disabled={!!busy || members.length < 2}>
            {busy === "set_pool_status" && <Spinner />} Lock group & share numbers
          </Button>
        )}
        {isHost && pool.status === "locked" && (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="ghost" onClick={() => rpc("set_pool_status", { p_pool: pool.id, p_status: "open" })} disabled={!!busy}>
              Reopen
            </Button>
            <Button onClick={() => rpc("set_pool_status", { p_pool: pool.id, p_status: "completed" })} disabled={!!busy}>
              Ride done
            </Button>
          </div>
        )}
        {(pool.status === "open" || pool.status === "locked") && (
          <Button
            variant="outline"
            full
            disabled={!!busy}
            onClick={() => {
              if (confirm("Leave this pool?")) rpc("leave_pool", { p_pool: pool.id }, () => router.push("/dashboard"));
            }}
          >
            Leave pool
          </Button>
        )}
      </div>

      <PoolChat poolId={pool.id} me={me} people={people} initial={initialMessages} />
    </div>
  );
}
