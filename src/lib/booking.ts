import type { PoolPlan } from "./types";

/**
 * Who books and pays the cab: whoever volunteered, else the rider going farthest
 * (largest road distance from the airport). Ties go to whoever is dropped last.
 */
export function effectiveBooker(
  bookerId: string | null,
  plan: Pick<PoolPlan, "drop_order" | "shares"> | null,
  fallback: string,
): { id: string; reason: "volunteer" | "farthest" } {
  if (bookerId) return { id: bookerId, reason: "volunteer" };
  if (!plan?.shares?.length) return { id: fallback, reason: "farthest" };
  let best = plan.shares[0];
  for (const s of plan.shares) {
    const later = plan.drop_order.indexOf(s.user_id) > plan.drop_order.indexOf(best.user_id);
    if (s.km > best.km || (s.km === best.km && later)) best = s;
  }
  return { id: best.user_id, reason: "farthest" };
}

/** "rj 14 cd-1234" → "RJ14CD1234" */
export const normalizeCarNumber = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Indian number plates: state + district + series + number (RJ14CD1234, DL3CAB1234), or BH series (22BH1234AA). */
export const CAR_NUMBER_RE = /^([A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}|\d{2}BH\d{4}[A-Z]{1,2})$/;

export function validateCarNumber(v: string) {
  const n = normalizeCarNumber(v);
  if (!n) return "Enter the car's number plate.";
  return CAR_NUMBER_RE.test(n) ? null : "That doesn't look like a number plate. Try something like RJ14 CD 1234.";
}

export function validateDriverName(v: string) {
  const n = v.trim();
  if (n.length < 2) return "Enter the driver's name as shown in the app.";
  return n.length > 60 ? "Name is too long." : null;
}

/** "RJ14CD1234" → "RJ 14 CD 1234" for display. */
export function formatCarNumber(n: string) {
  const m = n.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{4})$/);
  return m ? [m[1], m[2], m[3], m[4]].filter(Boolean).join(" ") : n;
}
