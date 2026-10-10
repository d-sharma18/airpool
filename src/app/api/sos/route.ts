import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { allow, tooMany } from "@/lib/rate-limit";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const valid = (lat: unknown, lng: unknown) =>
  typeof lat === "number" && typeof lng === "number" && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

async function caller() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

/** Start an SOS share: returns a private link that shows this rider's live location. */
export async function POST(req: NextRequest) {
  const { poolId, lat, lng, accuracy } = (await req.json().catch(() => ({}))) as {
    poolId?: string;
    lat?: number;
    lng?: number;
    accuracy?: number;
  };
  const { supabase, user } = await caller();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (!(await allow("sos", user.id))) return tooMany("Too many SOS updates. Call 112 if you're in danger.");

  // RLS: only members can see the pool.
  const { data: pool } = await supabase.from("pools").select("id").eq("id", poolId).maybeSingle();
  if (!pool) return NextResponse.json({ error: "Group not found" }, { status: 404 });

  const token = randomBytes(18).toString("base64url");
  const has = valid(lat, lng);
  const { error } = await createAdminClient()
    .from("sos_shares")
    .insert({
      token,
      pool_id: pool.id,
      user_id: user.id,
      lat: has ? lat : null,
      lng: has ? lng : null,
      accuracy_m: has && typeof accuracy === "number" ? accuracy : null,
      updated_at: has ? new Date().toISOString() : null,
    });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ token, url: `${req.nextUrl.origin}/sos/${token}` });
}

/** Push a new position (the sharer's page calls this every ~20 s while sharing). */
export async function PATCH(req: NextRequest) {
  const { token, lat, lng, accuracy, stop } = (await req.json().catch(() => ({}))) as {
    token?: string;
    lat?: number;
    lng?: number;
    accuracy?: number;
    stop?: boolean;
  };
  const { user } = await caller();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (!(await allow("sos", user.id))) return tooMany("Too many SOS updates. Call 112 if you're in danger.");
  if (!token || (!stop && !valid(lat, lng))) return NextResponse.json({ error: "Bad location" }, { status: 400 });

  const update = stop
    ? { stopped: true }
    : { lat, lng, accuracy_m: typeof accuracy === "number" ? accuracy : null, updated_at: new Date().toISOString() };
  const { data, error } = await createAdminClient()
    .from("sos_shares")
    .update(update)
    .eq("token", token)
    .eq("user_id", user.id)
    .gt("expires_at", new Date().toISOString())
    .select("token");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "This SOS link has expired" }, { status: 410 });
  return NextResponse.json({ ok: true });
}
