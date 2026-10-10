import { describe, expect, it } from "vitest";
import { checkAiSplit, formulaAmounts, formulaSplit, splitPrompt } from "./fare";

// Drop order: Tonk Road (4 km), Malviya Nagar (7 km), Mansarovar (14 km) → 25 km total.
const riders = [
  { user_id: "bea", km: 4 },
  { user_id: "asha", km: 7 },
  { user_id: "carl", km: 14 },
];
const ids = new Map([["R1", "bea"], ["R2", "asha"], ["R3", "carl"]]);
const total = 601; // doesn't divide evenly, to exercise rounding

describe("formula split", () => {
  it("is total × my distance ÷ everyone's distance", () => {
    const f = formulaAmounts(total, riders);
    expect(f.get("bea")).toBeCloseTo((601 * 4) / 25);
    expect(f.get("carl")).toBeCloseTo((601 * 14) / 25);
  });

  it("uses whole rupees, adds up exactly, and gives rounding to the booker", () => {
    // Exact: 96.16, 168.28, 336.56 → rounded 96, 168, 337 = 601. Make Asha the booker.
    const s = formulaSplit(total, riders, "asha");
    expect(s.every((x) => Number.isInteger(x.amount))).toBe(true);
    expect(s.reduce((a, x) => a + x.amount, 0)).toBe(total);
    const s2 = formulaSplit(602, riders, "asha"); // 96.32, 168.56, 337.12 → 96, 169, 337 = 602
    expect(s2.reduce((a, x) => a + x.amount, 0)).toBe(602);
    const s3 = formulaSplit(100, [{ user_id: "a", km: 1 }, { user_id: "b", km: 1 }, { user_id: "c", km: 1 }], "c");
    expect(s3.map((x) => x.amount)).toEqual([33, 33, 34]); // the extra rupee goes to booker c
    expect(s3[2].reason).toMatch(/₹1 rounding extra as the booker/);
  });

  it("explains each share by distance", () => {
    expect(formulaSplit(total, riders, "asha")[0].reason).toBe("4 of 25 km (16%) of the total distance.");
  });

  it("splits equally when every distance is zero", () => {
    expect(formulaSplit(90, [{ user_id: "a", km: 0 }, { user_id: "b", km: 0 }], "a").map((x) => x.amount)).toEqual([45, 45]);
  });
});

describe("checking Gemini's split", () => {
  // Formula: 96.16, 168.28, 336.56
  const good = { shares: [
    { rider: "R1", amount: 96, reason: "Dropped first, shortest ride." },
    { rider: "R2", amount: 168, reason: "Middle drop." },
    { rider: "R3", amount: 337, reason: "Rides the furthest." },
  ] };

  it("accepts a split that adds up and stays within 10% of the formula", () => {
    const r = checkAiSplit(total, riders, ids, good);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.shares.map((s) => [s.user_id, s.amount])).toEqual([["bea", 96], ["asha", 168], ["carl", 337]]);
  });

  it("accepts answers within 10% even if not equal to the formula", () => {
    const r = checkAiSplit(total, riders, ids, { shares: [
      { rider: "R1", amount: 105, reason: "a" }, // +9.2%
      { rider: "R2", amount: 160, reason: "b" }, // −4.9%
      { rider: "R3", amount: 336, reason: "c" },
    ] });
    expect(r.ok).toBe(true);
  });

  it("rejects amounts that don't add up exactly", () => {
    const bad = { shares: good.shares.map((s, i) => (i === 2 ? { ...s, amount: 336 } : s)) };
    expect(checkAiSplit(total, riders, ids, bad)).toEqual({ ok: false, why: "adds up to ₹600, not ₹601" });
  });

  it("rejects any amount more than 10% off the formula", () => {
    const bad = { shares: [
      { rider: "R1", amount: 110, reason: "a" }, // +14%
      { rider: "R2", amount: 160, reason: "b" },
      { rider: "R3", amount: 331, reason: "c" },
    ] };
    const r = checkAiSplit(total, riders, ids, bad);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.why).toMatch(/R1 is more than 10% off/);
  });

  it("rejects missing, repeated, unknown or non-integer riders and empty reasons", () => {
    const cases = [
      { shares: good.shares.slice(0, 2) },
      { shares: [good.shares[0], good.shares[0], good.shares[2]] },
      { shares: [{ ...good.shares[0], rider: "R9" }, good.shares[1], good.shares[2]] },
      { shares: [{ ...good.shares[0], amount: 96.5 }, good.shares[1], { ...good.shares[2], amount: 336.5 }] },
      { shares: [{ ...good.shares[0], reason: "" }, good.shares[1], good.shares[2]] },
      { nope: true },
      null,
    ];
    for (const c of cases) expect(checkAiSplit(total, riders, ids, c).ok).toBe(false);
  });

  it("accepts lower-case or padded rider labels", () => {
    const r = checkAiSplit(total, riders, ids, { shares: good.shares.map((s) => ({ ...s, rider: ` ${s.rider.toLowerCase()} ` })) });
    expect(r.ok).toBe(true);
  });
});

describe("prompt", () => {
  it("sends the total, drop order and road distances, but no names", () => {
    const p = splitPrompt(total, riders, ["R1", "R2", "R3"], "R2", "Jaipur");
    expect(p).toContain("₹601");
    expect(p).toContain("R1: drop #1, 4 km from the airport by road");
    expect(p).toContain("R3: drop #3, 14 km");
    expect(p).toContain("One rider (R2) booked");
    expect(p).toContain("within 10%");
    expect(p).not.toMatch(/bea|asha|carl/);
  });
});
