import { NextResponse, type NextRequest } from "next/server";
import { allow, tooMany } from "@/lib/rate-limit";
import { airportByIata } from "@/lib/airports";
import { effectiveBooker, normalizeCarNumber, validateCarNumber, validateDriverName } from "@/lib/booking";
import { finalSplit } from "@/lib/fare-final";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import type { Pool } from "@/lib/types";

export const runtime = "nodejs";

interface Body {
  poolId?: string;
  driverName?: string;
  carNumber?: string;
  carModel?: string;
  fare?: number;
}

/**
 * The booker saves what Uber/Ola showed after they booked: driver, number plate and final fare.
 * Everyone in the group sees it live (Realtime on `pools`), and each rider's share is
 * worked out from the real fare.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (!(await allow("booking", user.id))) return tooMany("Too many booking updates. Wait a few minutes and try again.");

  // RLS: only members can read the pool.
  const { data: pool } = await supabase.from("pools").select("*").eq("id", body.poolId).maybeSingle<Pool>();
  if (!pool) return NextResponse.json({ error: "Group not found" }, { status: 404 });
  if (pool.status !== "locked" && pool.status !== "completed") {
    return NextResponse.json({ error: "Book once the group is locked" }, { status: 409 });
  }
  if (!pool.plan?.shares?.length) {
    return NextResponse.json({ error: "The route isn't ready yet. Try again in a moment." }, { status: 409 });
  }

  const booker = effectiveBooker(pool.booker_id, pool.plan, pool.created_by);
  if (booker.id !== user.id) return NextResponse.json({ error: "Only the booker can enter the booking" }, { status: 403 });

  const errors = {
    driverName: validateDriverName(body.driverName ?? ""),
    carNumber: validateCarNumber(body.carNumber ?? ""),
    carModel: (body.carModel ?? "").trim().length > 40 ? "Keep the car description short." : null,
    fare: Number.isInteger(body.fare) && body.fare! >= 50 && body.fare! <= 50_000 ? null : "Enter the fare in whole rupees (₹50–₹50,000).",
  };
  if (Object.values(errors).some(Boolean)) return NextResponse.json({ error: "Check the highlighted fields", fields: errors }, { status: 400 });

  const city = airportByIata(pool.airport_iata)?.city ?? "India";
  // Re-split only when the fare changed; fixing a typo in the plate shouldn't call Gemini again.
  const plan = pool.plan.final && pool.plan.fare_total === body.fare ? pool.plan : await finalSplit(pool.plan, body.fare!, user.id, city);

  const { error } = await createAdminClient()
    .from("pools")
    .update({
      booker_id: user.id,
      driver_name: body.driverName!.trim(),
      car_number: normalizeCarNumber(body.carNumber!),
      car_model: body.carModel?.trim() || null,
      booked_at: pool.booked_at ?? new Date().toISOString(),
      plan,
    })
    .eq("id", pool.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, plan });
}
