import { describe, expect, it } from "vitest";
import { effectiveBooker, formatCarNumber, normalizeCarNumber, validateCarNumber, validateDriverName } from "./booking";
import { upiAppLinks, upiLink, uberLink } from "./deeplinks";

const plan = {
  drop_order: ["tonk", "mal", "man"],
  shares: [
    { user_id: "tonk", km: 6.3, amount: 0, formula: 0, reason: "" },
    { user_id: "mal", km: 8.3, amount: 0, formula: 0, reason: "" },
    { user_id: "man", km: 10.2, amount: 0, formula: 0, reason: "" },
  ],
};

describe("who books", () => {
  it("a volunteer always wins", () => {
    expect(effectiveBooker("tonk", plan, "host")).toEqual({ id: "tonk", reason: "volunteer" });
  });
  it("otherwise the rider going farthest pays", () => {
    expect(effectiveBooker(null, plan, "host")).toEqual({ id: "man", reason: "farthest" });
  });
  it("on a tie, whoever is dropped last", () => {
    const tie = { ...plan, shares: plan.shares.map((s) => ({ ...s, km: 5 })) };
    expect(effectiveBooker(null, tie, "host").id).toBe("man");
  });
  it("falls back to the host before the route is ready", () => {
    expect(effectiveBooker(null, null, "host").id).toBe("host");
  });
});

describe("car number", () => {
  it("accepts Indian plates in any spacing and case", () => {
    for (const v of ["RJ14CD1234", "rj 14 cd 1234", "RJ-14-CD-1234", "DL3CAB1234", "MH01AB0001", "KA05M1234", "22BH1234AA"]) {
      expect(validateCarNumber(v)).toBeNull();
    }
  });
  it("rejects junk", () => {
    for (const v of ["", "1234", "RJ14", "ABCDEFGH", "RJ14CD12345"]) expect(validateCarNumber(v)).not.toBeNull();
  });
  it("normalises and formats", () => {
    expect(normalizeCarNumber("rj 14 cd-1234")).toBe("RJ14CD1234");
    expect(formatCarNumber("RJ14CD1234")).toBe("RJ 14 CD 1234");
  });
  it("checks the driver's name", () => {
    expect(validateDriverName("Ramesh")).toBeNull();
    expect(validateDriverName(" ")).not.toBeNull();
  });
});

describe("links", () => {
  it("Uber deep link has pickup and drop-off filled in", () => {
    const u = new URL(uberLink({ lat: 26.8242, lng: 75.8122, name: "JAI Airport" }, { lat: 26.8686, lng: 75.757, name: "Mansarovar", address: "Mansarovar, Jaipur" }));
    expect(u.origin + u.pathname).toBe("https://m.uber.com/ul/");
    expect(u.searchParams.get("action")).toBe("setPickup");
    expect(u.searchParams.get("pickup[latitude]")).toBe("26.8242");
    expect(u.searchParams.get("dropoff[nickname]")).toBe("Mansarovar");
    expect(u.searchParams.get("dropoff[formatted_address]")).toBe("Mansarovar, Jaipur");
  });

  it("UPI link pays the booker the member's exact amount", () => {
    const link = upiLink("asha@okaxis", "Asha Verma", 247, "Airpool JAI cab share");
    expect(link.startsWith("upi://pay?")).toBe(true);
    const q = new URLSearchParams(link.split("?")[1]);
    expect(q.get("pa")).toBe("asha@okaxis");
    expect(q.get("pn")).toBe("Asha Verma");
    expect(q.get("am")).toBe("247.00");
    expect(q.get("cu")).toBe("INR");
  });

  it("offers GPay, PhonePe and Paytm links for iPhone", () => {
    const apps = upiAppLinks("asha@okaxis", "Asha Verma", 247, "x");
    expect(apps.map((a) => a.app)).toEqual(["GPay", "PhonePe", "Paytm"]);
    expect(apps.every((a) => a.href.includes("pa=asha%40okaxis") && a.href.includes("am=247.00"))).toBe(true);
  });
});
