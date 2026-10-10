import type { FareShare, VehicleClass } from "./types";
import { VEHICLES } from "./vehicle";

const AIRPORT_FEE = 80;

export function estimateFareByRules(vehicle: VehicleClass, km: number) {
  const spec = VEHICLES[vehicle];
  return Math.round((spec.base + spec.perKm * km + AIRPORT_FEE) / 10) * 10;
}

export interface SplitInput {
  user_id: string;
  /** Road distance from the airport to this rider's drop, along the planned route. */
  km: number;
}

/** The simple formula: total × this rider's distance ÷ everyone's distances added up. */
export function formulaAmounts(total: number, riders: SplitInput[]): Map<string, number> {
  const sum = riders.reduce((s, r) => s + r.km, 0);
  return new Map(riders.map((r) => [r.user_id, sum > 0 ? (total * r.km) / sum : total / riders.length]));
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * Formula split in whole rupees. Rounding leftovers go to the booker, so the
 * shares always add up exactly to the fare.
 */
export function formulaSplit(total: number, riders: SplitInput[], bookerId: string): FareShare[] {
  const exact = formulaAmounts(total, riders);
  const sumKm = riders.reduce((s, r) => s + r.km, 0);
  const shares: FareShare[] = riders.map((r) => {
    const f = exact.get(r.user_id)!;
    return {
      user_id: r.user_id,
      km: round1(r.km),
      formula: Math.round(f),
      amount: Math.round(f),
      reason: sumKm > 0 ? `${round1(r.km)} of ${round1(sumKm)} km (${pct(r.km / sumKm)}) of the total distance.` : "Split equally.",
    };
  });
  const diff = total - shares.reduce((s, x) => s + x.amount, 0);
  const booker = shares.find((s) => s.user_id === bookerId) ?? shares[0];
  if (booker && diff !== 0) {
    booker.amount += diff;
    booker.reason += ` Includes ₹${Math.abs(diff)} rounding ${diff > 0 ? "extra" : "less"} as the booker.`;
  }
  return shares;
}

export interface AiSplitAnswer {
  shares: { rider: string; amount: number; reason: string }[];
}

export type SplitCheck = { ok: true; shares: FareShare[] } | { ok: false; why: string };

/**
 * Accept the AI's split only if it covers every rider exactly once, uses whole rupees,
 * adds up exactly to the total, and keeps every amount within 10% of the formula.
 * `ids` maps the anonymous labels we sent (R1, R2…) back to user ids.
 */
export function checkAiSplit(total: number, riders: SplitInput[], ids: Map<string, string>, answer: unknown): SplitCheck {
  const list = (answer as AiSplitAnswer | null)?.shares;
  if (!Array.isArray(list)) return { ok: false, why: "no shares array" };
  if (list.length !== riders.length) return { ok: false, why: "wrong number of riders" };
  const formula = formulaAmounts(total, riders);
  const seen = new Set<string>();
  const shares: FareShare[] = [];
  for (const s of list) {
    const userId = ids.get(String(s?.rider ?? "").trim().toUpperCase());
    if (!userId || seen.has(userId)) return { ok: false, why: `unknown or repeated rider ${s?.rider}` };
    seen.add(userId);
    const amount = Number(s.amount);
    if (!Number.isInteger(amount) || amount < 0) return { ok: false, why: `amount for ${s.rider} isn't whole rupees` };
    const f = formula.get(userId)!;
    if (Math.abs(amount - f) > 0.1 * f + 1e-9) return { ok: false, why: `amount for ${s.rider} is more than 10% off the formula` };
    const reason = String(s.reason ?? "").trim().slice(0, 160);
    if (!reason) return { ok: false, why: `no reason for ${s.rider}` };
    const r = riders.find((x) => x.user_id === userId)!;
    shares.push({ user_id: userId, km: round1(r.km), formula: Math.round(f), amount, reason });
  }
  const sum = shares.reduce((a, s) => a + s.amount, 0);
  if (sum !== total) return { ok: false, why: `adds up to ₹${sum}, not ₹${total}` };
  return { ok: true, shares };
}

/** Prompt with anonymous labels, so no names leave our server. */
export function splitPrompt(total: number, riders: SplitInput[], labels: string[], bookerLabel: string, city: string) {
  const formula = formulaAmounts(total, riders);
  const rows = riders
    .map((r, i) => `${labels[i]}: drop #${i + 1}, ${round1(r.km)} km from the airport by road (formula ₹${formula.get(r.user_id)!.toFixed(2)})`)
    .join("\n");
  return (
    `A shared airport cab in ${city}, India cost ₹${total} in total. One rider (${bookerLabel}) booked and paid the full fare.\n` +
    `Riders in drop order (first dropped first):\n${rows}\n\n` +
    `Split the ₹${total} fairly by distance. Rules: whole rupees only; the amounts must add up to exactly ₹${total}; ` +
    `each amount must stay within 10% of its formula value (total × rider km ÷ sum of all km); ` +
    `give any rounding difference to the booker.\n` +
    `Return only JSON: {"shares": [{"rider": "R1", "amount": 123, "reason": "one short line"}]} with one entry per rider.`
  );
}

const round1 = (n: number) => Math.round(n * 10) / 10;
