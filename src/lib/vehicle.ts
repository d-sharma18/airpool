import type { VehicleClass, VehicleRecommendation } from "./types";

/** The three cars we book. `bags` counts check-in-size bags; 2 cabin bags = 1 check-in bag. */
export const VEHICLES: Record<
  VehicleClass,
  { label: string; uber: string; ola: string; seats: number; bags: number; base: number; perKm: number }
> = {
  mini: { label: "Mini", uber: "Uber Go", ola: "Ola Mini", seats: 3, bags: 2, base: 60, perKm: 13 },
  sedan: { label: "Sedan", uber: "Uber Premier", ola: "Ola Prime Sedan", seats: 4, bags: 3, base: 80, perKm: 16 },
  suv: { label: "SUV", uber: "Uber XL", ola: "Ola Prime SUV", seats: 6, bags: 5, base: 110, perKm: 21 },
};

/** Smallest first. */
export const VEHICLE_ORDER: VehicleClass[] = ["mini", "sedan", "suv"];

export interface RiderLoad {
  pax: number;
  checked: number;
  cabin: number;
  /** The rider's preferred car, if any. Treated as a minimum. */
  preferred?: VehicleClass | "any" | null;
}

export interface GroupLoad {
  pax: number;
  checked: number;
  cabin: number;
  /** checked + cabin/2, rounded up: 2 cabin bags take the space of 1 check-in bag. */
  bagUnits: number;
}

export function totalLoad(riders: RiderLoad[]): GroupLoad {
  const pax = riders.reduce((s, r) => s + r.pax, 0);
  const checked = riders.reduce((s, r) => s + r.checked, 0);
  const cabin = riders.reduce((s, r) => s + r.cabin, 0);
  return { pax, checked, cabin, bagUnits: checked + Math.ceil(cabin / 2) };
}

export const fits = (v: VehicleClass, load: GroupLoad) =>
  VEHICLES[v].seats >= load.pax && VEHICLES[v].bags >= load.bagUnits;

/** "a Mini", "a Sedan", "an SUV". */
const an = (v: VehicleClass) => `${v === "suv" ? "an" : "a"} ${VEHICLES[v].label}`;

const rank = (v: VehicleClass) => VEHICLE_ORDER.indexOf(v);
const bigger = (a: VehicleClass, b: VehicleClass) => (rank(a) >= rank(b) ? a : b);

/** Largest car any rider asked for ("any" counts as no preference). */
function largestPreference(riders: RiderLoad[]): VehicleClass | null {
  return riders.reduce<VehicleClass | null>((best, r) => {
    const p = r.preferred && r.preferred !== "any" ? r.preferred : null;
    return p ? (best ? bigger(best, p) : p) : best;
  }, null);
}

function describe(load: GroupLoad) {
  const people = `${load.pax} ${load.pax === 1 ? "person" : "people"}`;
  const bags = `${load.bagUnits} bag${load.bagUnits === 1 ? "" : "s"}`;
  return { people, bags };
}

function recommendation(
  vehicle: VehicleClass,
  load: GroupLoad,
  reason: string,
  confidence: number,
  source: VehicleRecommendation["source"],
  overridden?: VehicleRecommendation["overridden"],
): VehicleRecommendation {
  const v = VEHICLES[vehicle];
  return { vehicle, label: v.label, uber: v.uber, ola: v.ola, seats: v.seats, reason, confidence, source, load, overridden };
}

/**
 * Rule-based pick: the smallest car whose seats and boot fit the whole group, never smaller
 * than any rider's preferred car. If nothing fits, an SUV with a warning to split.
 */
export function recommendVehicleByRules(riders: RiderLoad[]): VehicleRecommendation {
  const load = totalLoad(riders);
  const { people, bags } = describe(load);
  const fit = VEHICLE_ORDER.find((v) => fits(v, load));
  if (!fit) {
    return recommendation(
      "suv",
      load,
      `${people} with ${bags} is more than one SUV can take (6 seats, 5 bags). Book an SUV and send extra bags in a second cab.`,
      0.6,
      "rules",
    );
  }
  const pref = largestPreference(riders);
  const pick = pref ? bigger(fit, pref) : fit;
  const smaller = VEHICLE_ORDER[rank(fit) - 1];
  let reason: string;
  if (pick !== fit) {
    reason = `${people} with ${bags} fit in ${an(fit)}, but a rider asked for ${an(pick)}.`;
  } else if (smaller) {
    const s = VEHICLES[smaller];
    const why = load.pax > s.seats ? `${an(smaller)} (${s.seats} seats)` : `${an(smaller)} boot (${s.bags} bags)`;
    reason = `${people} with ${bags} won't fit in ${why}. Take ${an(fit)}.`;
  } else {
    reason = `${people} with ${bags} fit comfortably in ${an(fit)}, the cheapest option.`;
  }
  return recommendation(pick, load, reason, 1, "rules");
}

/** The JSON we ask the AI for. */
export interface AiVehicleAnswer {
  car_type: string;
  confidence: number;
  reason: string;
}

export function vehiclePrompt(riders: RiderLoad[], ctx: { city: string; km: number }) {
  const load = totalLoad(riders);
  const groups = riders
    .map(
      (r, i) =>
        `- Rider ${i + 1}: ${r.pax} ${r.pax === 1 ? "person" : "people"}, ${r.checked} check-in bag(s), ${r.cabin} cabin bag(s)` +
        (r.preferred && r.preferred !== "any" ? `, prefers ${r.preferred}` : ""),
    )
    .join("\n");
  const cars = VEHICLE_ORDER.map((v) => `- ${v}: ${VEHICLES[v].seats} passengers, ${VEHICLES[v].bags} check-in bags`).join("\n");
  return (
    `Recommend ONE app cab for this airport cab-share group in ${city(ctx.city)}, India (${ctx.km.toFixed(1)} km trip).\n\n` +
    `Groups in the cab:\n${groups}\n\n` +
    `Total: ${load.pax} people, ${load.checked} check-in bags, ${load.cabin} cabin bags. ` +
    `Two cabin bags take the space of one check-in bag, so that's ${load.bagUnits} check-in-size bags.\n\n` +
    `Cars available (smallest and cheapest first):\n${cars}\n\n` +
    `Pick the cheapest car that fits everyone and every bag, and respect any rider's preference as a minimum.\n` +
    `Return only JSON: {"car_type": "mini" | "sedan" | "suv", "confidence": number between 0 and 1, ` +
    `"reason": one short sentence like "4 people with 4 big bags won't fit in a sedan boot. Take an SUV."}`
  );
}
const city = (c: string) => c || "an Indian city";

/**
 * Decide between the AI's answer and the rules. The rules win when the AI fails, returns
 * something unusable, or picks a car smaller than the rules allow (too few seats, too small a
 * boot, or below a rider's preference). A bigger car is accepted if the AI is fairly sure.
 */
export function pickVehicle(
  riders: RiderLoad[],
  ai: { data: Partial<AiVehicleAnswer>; source: "gemini" | "groq" } | null,
): VehicleRecommendation {
  const rules = recommendVehicleByRules(riders);
  if (!ai) return rules;

  const car = String(ai.data.car_type ?? "").toLowerCase().trim() as VehicleClass;
  const confidence = Number(ai.data.confidence);
  const reason = String(ai.data.reason ?? "").trim().slice(0, 200);
  if (!VEHICLE_ORDER.includes(car) || !reason || !(confidence >= 0 && confidence <= 1)) return rules;

  const tooSmall = rank(car) < rank(rules.vehicle);
  const needlesslyBig = rank(car) > rank(rules.vehicle) && confidence < 0.7;
  if (tooSmall || needlesslyBig) {
    return { ...rules, overridden: { aiPick: car, source: ai.source, why: tooSmall ? "too_small" : "too_big" } };
  }
  return recommendation(car, rules.load, reason, Math.round(confidence * 100) / 100, ai.source);
}
