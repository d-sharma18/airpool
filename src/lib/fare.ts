import type { FareShare, VehicleClass, VehicleRecommendation } from "./types";

interface VehicleSpec {
  label: string;
  uber: string;
  ola: string;
  seats: number;
  /** Boot space in "suitcase units": a checked bag = 1, a cabin bag = 0.5. */
  boot: number;
  base: number;
  perKm: number;
}

export const VEHICLES: Record<VehicleClass, VehicleSpec> = {
  mini: { label: "Hatchback", uber: "Uber Go", ola: "Ola Mini", seats: 4, boot: 2, base: 60, perKm: 13 },
  sedan: { label: "Sedan", uber: "Uber Premier", ola: "Ola Prime Sedan", seats: 4, boot: 3.5, base: 80, perKm: 16 },
  suv: { label: "SUV", uber: "Uber XL", ola: "Ola Prime SUV", seats: 6, boot: 5, base: 110, perKm: 21 },
  xl: { label: "Large SUV (Innova)", uber: "Uber XL+", ola: "Ola Prime SUV+", seats: 6, boot: 7, base: 140, perKm: 25 },
};

const ORDER: VehicleClass[] = ["mini", "sedan", "suv", "xl"];
const AIRPORT_FEE = 80;

export interface LoadSummary {
  pax: number;
  cabin: number;
  checked: number;
}

export function luggageUnits({ cabin, checked }: LoadSummary) {
  return checked + cabin * 0.5;
}

/** Deterministic fallback when both AI providers are unavailable. */
export function recommendVehicleByRules(load: LoadSummary): VehicleRecommendation {
  const units = luggageUnits(load);
  const fit = ORDER.find((v) => VEHICLES[v].seats >= load.pax && VEHICLES[v].boot >= units);
  const vehicle = fit ?? "xl";
  const spec = VEHICLES[vehicle];
  const reason = fit
    ? `${spec.label} is the cheapest class that fits ${load.pax} rider${load.pax > 1 ? "s" : ""}, ${load.checked} checked and ${load.cabin} cabin bag${load.cabin === 1 ? "" : "s"}.`
    : `${load.pax} riders and ${units} suitcase units exceed one car. Book the largest SUV or split into two cabs.`;
  return { vehicle, label: spec.label, uber: spec.uber, ola: spec.ola, seats: spec.seats, reason, source: "rules" };
}

export function vehicleFromClass(v: string): VehicleClass | null {
  return (ORDER as string[]).includes(v) ? (v as VehicleClass) : null;
}

export function estimateFareByRules(vehicle: VehicleClass, km: number) {
  const spec = VEHICLES[vehicle];
  return Math.round((spec.base + spec.perKm * km + AIRPORT_FEE) / 10) * 10;
}

export interface SplitRider {
  user_id: string;
  pax: number;
  /** 0-based position in the drop order. */
  drop: number;
}

/**
 * Split a fare by distance actually ridden. Every leg's cost is shared equally (per seat)
 * by everyone still in the cab on that leg, so the last drop pays for the stretch they ride alone.
 */
export function splitFare(total: number, legKm: number[], riders: SplitRider[], payerId?: string): FareShare[] {
  const weights = new Map<string, number>();
  const kms = new Map<string, number>();
  legKm.forEach((km, leg) => {
    const onboard = riders.filter((r) => r.drop >= leg);
    const seats = onboard.reduce((s, r) => s + r.pax, 0);
    for (const r of onboard) {
      weights.set(r.user_id, (weights.get(r.user_id) ?? 0) + (km * r.pax) / seats);
      kms.set(r.user_id, (kms.get(r.user_id) ?? 0) + km);
    }
  });
  const totalWeight = [...weights.values()].reduce((a, b) => a + b, 0) || 1;
  const shares = riders.map((r) => ({
    user_id: r.user_id,
    km: Math.round((kms.get(r.user_id) ?? 0) * 10) / 10,
    amount: Math.round((total * (weights.get(r.user_id) ?? 0)) / totalWeight),
  }));
  // Rounding leftovers go to the payer so the shares always add up to the fare.
  const diff = total - shares.reduce((s, x) => s + x.amount, 0);
  const target = shares.find((s) => s.user_id === payerId) ?? shares[0];
  if (target) target.amount += diff;
  return shares;
}
