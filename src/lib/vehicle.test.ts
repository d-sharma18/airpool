import { describe, expect, it } from "vitest";
import { pickVehicle, recommendVehicleByRules, totalLoad, vehiclePrompt, type RiderLoad } from "./vehicle";

const rider = (pax: number, checked: number, cabin = 0, preferred?: RiderLoad["preferred"]): RiderLoad => ({ pax, checked, cabin, preferred });
const pick = (riders: RiderLoad[]) => recommendVehicleByRules(riders).vehicle;

describe("rule-based vehicle", () => {
  it("Mini fits 3 passengers with 2 check-in bags", () => {
    expect(pick([rider(3, 2)])).toBe("mini");
    expect(pick([rider(4, 0)])).toBe("sedan"); // 4th person
    expect(pick([rider(2, 3)])).toBe("sedan"); // 3rd bag
  });

  it("Sedan fits 4 with 3 bags", () => {
    expect(pick([rider(2, 2), rider(2, 1)])).toBe("sedan");
    expect(pick([rider(5, 0)])).toBe("suv");
    expect(pick([rider(4, 4)])).toBe("suv");
  });

  it("SUV fits 6 with 5 bags", () => {
    expect(pick([rider(3, 3), rider(3, 2)])).toBe("suv");
  });

  it("counts 2 cabin bags as 1 check-in bag, rounding up", () => {
    expect(totalLoad([rider(1, 1, 2)]).bagUnits).toBe(2);
    expect(totalLoad([rider(1, 1, 3)]).bagUnits).toBe(3);
    expect(pick([rider(2, 1, 2)])).toBe("mini"); // 1 + 1 = 2 bags
    expect(pick([rider(2, 1, 3)])).toBe("sedan"); // 1 + 2 = 3 bags
  });

  it("explains why the smaller car doesn't fit", () => {
    expect(recommendVehicleByRules([rider(4, 4)]).reason).toBe("4 people with 4 bags won't fit in a Sedan boot (3 bags). Take an SUV.");
    expect(recommendVehicleByRules([rider(4, 0)]).reason).toBe("4 people with 0 bags won't fit in a Mini (3 seats). Take a Sedan.");
  });

  it("treats a rider's preferred car as a minimum", () => {
    expect(pick([rider(1, 0, 0, "suv")])).toBe("suv");
    expect(pick([rider(1, 0, 0, "any"), rider(1, 0, 0, "sedan")])).toBe("sedan");
    expect(pick([rider(4, 4, 0, "mini")])).toBe("suv"); // a preference never shrinks the car
  });

  it("flags loads too big for any car", () => {
    const r = recommendVehicleByRules([rider(3, 4), rider(3, 3)]);
    expect(r.vehicle).toBe("suv");
    expect(r.confidence).toBeLessThan(1);
    expect(r.reason).toMatch(/second cab/);
  });
});

describe("AI answer vs rules", () => {
  const group = [rider(2, 2), rider(2, 2)]; // 4 people, 4 bags → rules say SUV

  it("uses the rules when both AI providers fail", () => {
    const r = pickVehicle(group, null);
    expect(r).toMatchObject({ vehicle: "suv", source: "rules", confidence: 1 });
  });

  it("accepts a valid AI answer with its reason and confidence", () => {
    const r = pickVehicle(group, {
      source: "gemini",
      data: { car_type: "suv", confidence: 0.92, reason: "4 people with 4 big bags won't fit in a sedan boot. Take an SUV." },
    });
    expect(r).toMatchObject({ vehicle: "suv", source: "gemini", confidence: 0.92 });
    expect(r.reason).toMatch(/sedan boot/);
    expect(r.overridden).toBeUndefined();
  });

  it("overrides an AI pick that's too small", () => {
    const r = pickVehicle(group, { source: "groq", data: { car_type: "sedan", confidence: 0.95, reason: "A sedan is fine." } });
    expect(r).toMatchObject({ vehicle: "suv", source: "rules", overridden: { aiPick: "sedan", source: "groq", why: "too_small" } });
  });

  it("overrides an AI pick below a rider's preference", () => {
    const r = pickVehicle([rider(1, 0, 0, "suv")], { source: "gemini", data: { car_type: "mini", confidence: 0.9, reason: "Just one person." } });
    expect(r.vehicle).toBe("suv");
    expect(r.overridden?.why).toBe("too_small");
  });

  it("accepts a bigger car only when the AI is fairly sure", () => {
    const small = [rider(2, 1)];
    const sure = pickVehicle(small, { source: "gemini", data: { car_type: "sedan", confidence: 0.8, reason: "Bags look large." } });
    expect(sure).toMatchObject({ vehicle: "sedan", source: "gemini" });
    const unsure = pickVehicle(small, { source: "gemini", data: { car_type: "suv", confidence: 0.4, reason: "Maybe roomier." } });
    expect(unsure).toMatchObject({ vehicle: "mini", source: "rules", overridden: { why: "too_big" } });
  });

  it("ignores malformed AI output", () => {
    for (const data of [
      { car_type: "limo", confidence: 0.9, reason: "Fancy." },
      { car_type: "suv", confidence: 7, reason: "Bad confidence." },
      { car_type: "suv", confidence: 0.9, reason: "" },
      {},
    ]) {
      expect(pickVehicle(group, { source: "gemini", data }).source).toBe("rules");
    }
  });

  it("accepts the car type in any case", () => {
    expect(pickVehicle(group, { source: "gemini", data: { car_type: " SUV ", confidence: 0.9, reason: "Fits." } }).source).toBe("gemini");
  });
});

describe("prompt", () => {
  it("includes each group, the totals, the cabin-bag rule and the JSON shape", () => {
    const p = vehiclePrompt([rider(2, 2, 1, "sedan"), rider(1, 1, 1)], { city: "Jaipur", km: 14.2 });
    expect(p).toContain("Rider 1: 2 people, 2 check-in bag(s), 1 cabin bag(s), prefers sedan");
    expect(p).toContain("Rider 2: 1 person");
    expect(p).toContain("Total: 3 people, 3 check-in bags, 2 cabin bags");
    expect(p).toContain("4 check-in-size bags");
    expect(p).toContain('"car_type"');
    expect(p).toContain('"confidence"');
    expect(p).toContain("Jaipur");
  });
});
