"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/toaster";
import { Badge, Button, Card, ErrorNote, Field, Input, Spinner, buttonClass, cx } from "@/components/ui";
import { airportByIata } from "@/lib/airports";
import { effectiveBooker, formatCarNumber, validateCarNumber, validateDriverName } from "@/lib/booking";
import { olaLink, uberLink, upiAppLinks, upiLink } from "@/lib/deeplinks";
import { firstName, fmtTime, inr } from "@/lib/format";
import { dropArea } from "@/lib/share";
import { createClient } from "@/lib/supabase/client";
import type { Pool, PoolMember } from "@/lib/types";
import type { Contact, Person } from "../pool-view";

const heading = "font-mono text-xs uppercase tracking-[0.2em] text-muted";

export default function BookView({
  me,
  pool,
  members,
  people,
  contacts,
}: {
  me: string;
  pool: Pool;
  members: PoolMember[];
  people: Person[];
  contacts: Contact[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const toast = useToast();
  const airport = airportByIata(pool.airport_iata)!;
  const plan = pool.plan;
  const booked = !!pool.booked_at;

  // Full verified names (the group is locked, so contacts are available).
  const fullName = (id: string) => contacts.find((c) => c.user_id === id)?.name ?? people.find((p) => p.id === id)?.name ?? "Rider";
  const booker = effectiveBooker(pool.booker_id, plan, pool.created_by);
  const iAmBooker = booker.id === me;
  const bookerUpi = people.find((p) => p.id === booker.id)?.upi_id ?? null;

  // Driver details, fare and payments appear for everyone the moment they change.
  useEffect(() => {
    const ch = supabase
      .channel(`booking:${pool.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pools", filter: `id=eq.${pool.id}` }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "pool_members", filter: `pool_id=eq.${pool.id}` }, () =>
        router.refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [supabase, pool.id, router]);

  // Toast when the booking lands, for riders watching the screen.
  const [wasBooked, setWasBooked] = useState(booked);
  useEffect(() => {
    if (booked && !wasBooked && !iAmBooker) toast(`${firstName(fullName(booker.id))} booked the cab`, "success");
    setWasBooked(booked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booked]);

  const [busy, setBusy] = useState("");
  async function rpc(name: string, args: Record<string, unknown>, ok?: string) {
    setBusy(name);
    const { error } = await supabase.rpc(name, args);
    setBusy("");
    if (error) return toast(error.message, "error");
    if (ok) toast(ok, "success");
    router.refresh();
  }

  const ordered = (plan?.drop_order ?? members.map((m) => m.user_id))
    .map((id) => members.find((m) => m.user_id === id))
    .filter((m): m is PoolMember => !!m);
  const finalDrop = ordered.at(-1);
  const pickup = { lat: airport.lat, lng: airport.lng, name: `${airport.name} (${airport.iata})` };
  const drop = finalDrop && {
    lat: finalDrop.dest_lat,
    lng: finalDrop.dest_lng,
    name: dropArea(pool.airport_iata, finalDrop.dest_zone, finalDrop.dest_label),
    address: finalDrop.dest_label,
  };

  const shareOf = (id: string) => plan?.shares.find((s) => s.user_id === id)?.amount ?? 0;
  const others = ordered.filter((m) => m.user_id !== booker.id);
  const paidCount = others.filter((m) => m.paid).length;
  const outstanding = others.filter((m) => !m.paid).reduce((s, m) => s + shareOf(m.user_id), 0);
  const mine = members.find((m) => m.user_id === me);

  return (
    <div className="grid grid-cols-1 gap-4 pb-6">
      <Link href={`/pool/${pool.id}`} className="text-sm text-muted underline">
        ← Back to group
      </Link>
      <section>
        <p className="font-mono text-xs text-muted">
          {airport.iata} → {ordered.map((m) => dropArea(pool.airport_iata, m.dest_zone, m.dest_label)).join(" → ")}
        </p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Book &amp; pay</h1>
          <Badge tone={booked ? "ok" : "accent"}>{booked ? "Booked" : "Not booked yet"}</Badge>
        </div>
      </section>

      {/* 1. Who books */}
      <Card className="grid grid-cols-1 gap-3">
        <h2 className={heading}>Booker</h2>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold">
              {fullName(booker.id)}
              {iAmBooker && <span className="ml-1 text-xs font-normal text-muted">(you)</span>}
            </p>
            <p className="text-xs text-muted">
              {booked
                ? `Booked the cab ${pool.booked_at ? `at ${fmtTime(pool.booked_at)}` : ""} and paid the full fare`
                : booker.reason === "volunteer"
                  ? "Volunteered to book and pay the full fare"
                  : "Going farthest, so pays the full fare by default"}
            </p>
          </div>
          <Badge tone="accent">pays the cab</Badge>
        </div>
        {!booked && !iAmBooker && booker.reason === "farthest" && (
          <Button variant="ghost" full onClick={() => rpc("volunteer_booker", { p_pool: pool.id }, "You're the booker now")} disabled={!!busy}>
            {busy === "volunteer_booker" && <Spinner />} I&apos;ll book &amp; pay instead
          </Button>
        )}
        {!booked && iAmBooker && booker.reason === "volunteer" && (
          <button className="justify-self-start text-xs text-muted underline" onClick={() => rpc("withdraw_booker", { p_pool: pool.id }, "You stepped back")}>
            Step back as booker
          </button>
        )}
        <p className="text-xs text-muted">Everyone else pays the booker back by UPI once the fare is in.</p>
      </Card>

      {/* 2. Open Uber / Ola. We never book automatically */}
      {!booked && (
        <Card className="grid grid-cols-1 gap-3">
          <h2 className={heading}>Book the cab</h2>
          {iAmBooker && drop ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <a className={buttonClass("primary")} href={uberLink(pickup, drop)} target="_blank" rel="noreferrer">
                  Open in Uber
                </a>
                <a className={buttonClass("primary")} href={olaLink(pickup, drop)} target="_blank" rel="noreferrer">
                  Open in Ola
                </a>
              </div>
              <p className="text-xs text-muted">
                Pickup ({airport.iata}) and the final drop ({drop.name}) are filled in. Check them and book in the app;
                Airpool never books for you.
                {plan && ` Choose ${plan.vehicle.uber} or ${plan.vehicle.ola}.`}
              </p>
              {ordered.length > 1 && (
                <ol className="grid grid-cols-1 gap-1 rounded-xl bg-surface-2 p-3 text-sm">
                  <li className="text-xs text-muted">Add stops in this order:</li>
                  {ordered.slice(0, -1).map((m, i) => (
                    <li key={m.user_id}>
                      {i + 1}. {dropArea(pool.airport_iata, m.dest_zone, m.dest_label)}{" "}
                      <span className="text-xs text-muted">({m.dest_label.split(",")[0]})</span>
                    </li>
                  ))}
                </ol>
              )}
            </>
          ) : (
            <p className="text-sm text-muted">
              {firstName(fullName(booker.id))} is booking the cab. Driver details will appear here as soon as they&apos;re
              entered.
            </p>
          )}
        </Card>
      )}

      {/* 3. Driver details: entered by the booker, seen by everyone live */}
      {booked && (
        <Card className="grid grid-cols-1 gap-3 border-ok/30">
          <h2 className={heading}>Your cab</h2>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-xl tracking-wider">{formatCarNumber(pool.car_number ?? "")}</p>
              <p className="text-sm text-muted">{pool.car_model || "Car"}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted">Driver</p>
              <p className="font-semibold">{pool.driver_name}</p>
            </div>
          </div>
          <p className="text-sm">
            Final fare <span className="font-mono">{plan ? inr(plan.fare_total) : "-"}</span>
            <span className="text-muted"> · paid by {firstName(fullName(booker.id))}</span>
          </p>
          <p className="text-xs text-muted">Check the number plate before you get in.</p>
        </Card>
      )}

      {iAmBooker && <BookingForm pool={pool} onSaved={() => router.refresh()} />}

      {/* 4. Payments */}
      {booked && plan?.final && (
        <Card className="grid grid-cols-1 gap-3">
          <div className="flex items-center justify-between">
            <h2 className={heading}>Payments</h2>
            <Link href={`/pool/${pool.id}/fare`} className="text-xs text-muted underline">
              how it&apos;s split
            </Link>
          </div>
          <p className="text-sm">
            {paidCount} of {others.length} paid
            {outstanding > 0 && <span className="text-muted"> · {inr(outstanding)} still to collect</span>}
          </p>

          {!iAmBooker && mine && (
            <PayBox
              amount={shareOf(me)}
              payee={{ upi: bookerUpi, name: fullName(booker.id) }}
              note={`Airpool ${airport.iata} cab share`}
              paid={mine.paid}
              claimed={!!mine.paid_claimed_at}
              busy={busy === "claim_paid"}
              onClaim={() => rpc("claim_paid", { p_pool: pool.id }, `We've told ${firstName(fullName(booker.id))}`)}
            />
          )}
          {iAmBooker && !bookerUpi && (
            <ErrorNote>
              Add your UPI ID in{" "}
              <Link href="/profile" className="underline">
                Profile
              </Link>{" "}
              so riders can pay you back.
            </ErrorNote>
          )}

          <ul className="grid grid-cols-1 gap-2">
            {ordered.map((m) => {
              const isBooker = m.user_id === booker.id;
              const status = isBooker ? "booker" : m.paid ? "paid" : m.paid_claimed_at ? "claimed" : "unpaid";
              return (
                <li key={m.user_id} className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {fullName(m.user_id)}
                      {m.user_id === me && <span className="ml-1 text-xs text-muted">(you)</span>}
                    </p>
                    <p
                      className={cx(
                        "text-xs",
                        status === "paid" && "text-ok",
                        status === "claimed" && "text-accent",
                        (status === "unpaid" || status === "booker") && "text-muted",
                      )}
                    >
                      {status === "booker" && "Paid the cab"}
                      {status === "paid" && "✓ Paid"}
                      {status === "claimed" && `Says paid ${fmtTime(m.paid_claimed_at!)}. Waiting for the booker to confirm`}
                      {status === "unpaid" && "Not paid yet"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono">{inr(shareOf(m.user_id))}</span>
                    {iAmBooker && !isBooker && (
                      <button
                        className={cx("rounded-lg border px-2 py-1 text-xs", m.paid ? "border-ok/40 text-ok" : "border-line text-ink")}
                        onClick={() =>
                          rpc("set_member_paid", { p_pool: pool.id, p_user: m.user_id, p_paid: !m.paid }, m.paid ? "Marked unpaid" : "Payment confirmed")
                        }
                      >
                        {m.paid ? "Undo" : "Received"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}

function PayBox({
  amount,
  payee,
  note,
  paid,
  claimed,
  busy,
  onClaim,
}: {
  amount: number;
  payee: { upi: string | null; name: string };
  note: string;
  paid: boolean;
  claimed: boolean;
  busy: boolean;
  onClaim: () => void;
}) {
  if (paid) return <p className="rounded-xl bg-ok/10 px-3 py-2 text-sm text-ok">✓ Your payment is confirmed. You&apos;re all settled.</p>;
  if (!payee.upi) {
    return <p className="text-sm text-muted">{firstName(payee.name)} hasn&apos;t added a UPI ID yet. Ask them in the group chat.</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-2 rounded-xl border border-accent/30 bg-accent/5 p-3">
      <a className={buttonClass("primary", true)} href={upiLink(payee.upi, payee.name, amount, note)}>
        Pay {inr(amount)} to {firstName(payee.name)}
      </a>
      <p className="text-center text-xs text-muted">
        Opens GPay, PhonePe or any UPI app with {payee.upi} and {inr(amount)} filled in. Paid directly, with no payment
        gateway in between.
      </p>
      <div className="flex justify-center gap-3 text-xs">
        <span className="text-muted">On iPhone:</span>
        {upiAppLinks(payee.upi, payee.name, amount, note).map((a) => (
          <a key={a.app} href={a.href} className="text-accent underline">
            {a.app}
          </a>
        ))}
      </div>
      {claimed ? (
        <p className="rounded-xl bg-surface-2 px-3 py-2.5 text-center text-sm text-accent">
          You marked this as paid. Waiting for {firstName(payee.name)} to confirm.
        </p>
      ) : (
        <Button variant="outline" full onClick={onClaim} disabled={busy}>
          {busy && <Spinner />} I&apos;ve paid
        </Button>
      )}
    </div>
  );
}

function BookingForm({ pool, onSaved }: { pool: Pool; onSaved: () => void }) {
  const toast = useToast();
  const booked = !!pool.booked_at;
  const [editing, setEditing] = useState(!booked);
  const [v, setV] = useState({
    driverName: pool.driver_name ?? "",
    carNumber: pool.car_number ? formatCarNumber(pool.car_number) : "",
    carModel: pool.car_model ?? "",
    fare: booked && pool.plan ? String(pool.plan.fare_total) : "",
  });
  const [errs, setErrs] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);

  if (!editing) {
    return (
      <button className="justify-self-start text-sm text-muted underline" onClick={() => setEditing(true)}>
        Edit driver details or fare
      </button>
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const fare = Number(v.fare);
    const found = {
      driverName: validateDriverName(v.driverName),
      carNumber: validateCarNumber(v.carNumber),
      fare: Number.isInteger(fare) && fare >= 50 ? null : "Enter the final fare in whole rupees.",
    };
    setErrs(found);
    if (Object.values(found).some(Boolean)) return;
    setBusy(true);
    const res = await fetch("/api/booking", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ poolId: pool.id, driverName: v.driverName, carNumber: v.carNumber, carModel: v.carModel, fare }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) {
      if (body.fields) setErrs(body.fields);
      return toast(body.error ?? "Couldn't save the booking. Try again.", "error");
    }
    toast(body.plan?.split_method === "ai" ? "Booking shared. Fare split calculated by AI" : "Booking shared with the group", "success");
    setEditing(false);
    onSaved();
  }

  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  return (
    <Card className="grid grid-cols-1 gap-3 border-accent/40">
      <h2 className={heading}>{booked ? "Edit booking" : "After you book"}</h2>
      <p className="text-sm text-muted">Copy these from the Uber or Ola app. Everyone in the group sees them instantly.</p>
      <form onSubmit={save} noValidate className="grid grid-cols-1 gap-3">
        <Field id="driverName" label="Driver's name" error={errs.driverName}>
          <Input id="driverName" value={v.driverName} onChange={set("driverName")} invalid={!!errs.driverName} autoComplete="off" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field id="carNumber" label="Car number" error={errs.carNumber}>
            <Input
              id="carNumber"
              value={v.carNumber}
              onChange={set("carNumber")}
              invalid={!!errs.carNumber}
              placeholder="RJ14 CD 1234"
              autoCapitalize="characters"
              autoComplete="off"
            />
          </Field>
          <Field id="carModel" label="Car" hint="optional" error={errs.carModel}>
            <Input id="carModel" value={v.carModel} onChange={set("carModel")} placeholder="White Ertiga" maxLength={40} />
          </Field>
        </div>
        <Field id="fare" label="Final fare (₹)" hint="as shown in the app" error={errs.fare}>
          <Input
            id="fare"
            inputMode="numeric"
            value={v.fare}
            onChange={(e) => setV((s) => ({ ...s, fare: e.target.value.replace(/\D/g, "") }))}
            invalid={!!errs.fare}
            placeholder="612"
          />
        </Field>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Button type="submit" disabled={busy}>
            {busy && <Spinner />} {booked ? "Save changes" : "Share with group"}
          </Button>
          {booked && (
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}
