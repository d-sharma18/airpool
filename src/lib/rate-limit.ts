import "server-only";
import { NextResponse } from "next/server";
import { createAdminClient } from "./supabase/server";

/**
 * Limits per user (protects our endpoints) and per free API (protects the quotas).
 * Counted in Supabase, so they hold across every serverless instance.
 */
export const LIMITS = {
  // Per user
  flight: { limit: 10, windowSec: 3600 },
  matches: { limit: 30, windowSec: 600 },
  poolPlan: { limit: 20, windowSec: 3600 },
  booking: { limit: 10, windowSec: 3600 },
  sos: { limit: 200, windowSec: 3600 },
  aadhaar: { limit: 10, windowSec: 3600 },
  // Whole app, matching the providers' free tiers (with headroom)
  aviationstackMonth: { limit: 95, windowSec: 30 * 86400 },
  geminiDay: { limit: 1200, windowSec: 86400 },
  geminiMinute: { limit: 12, windowSec: 60 },
  groqDay: { limit: 900, windowSec: 86400 },
} as const;

export type LimitName = keyof typeof LIMITS;

/** True if this hit is allowed. Fails open if the database can't be reached. */
export async function allow(name: LimitName, who = "app"): Promise<boolean> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return true;
  const { limit, windowSec } = LIMITS[name];
  try {
    const { data, error } = await createAdminClient().rpc("hit_rate_limit", {
      p_key: `${name}:${who}`,
      p_limit: limit,
      p_window_seconds: windowSec,
    });
    return error ? true : data !== false;
  } catch {
    return true;
  }
}

/** Friendly 429 the UI shows as a toast. */
export function tooMany(message = "You're going a bit fast. Wait a minute and try again.") {
  return NextResponse.json({ error: message, rateLimited: true }, { status: 429 });
}
