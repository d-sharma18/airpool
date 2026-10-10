import { describe, expect, it } from "vitest";
import { MATCH_RULES, ZONES } from "@/config/matching";
import { kmBetween } from "./geo";
import { evaluate, findMatches, zoneFor, type CandidateMember, type CandidatePool, type MatchRequest } from "./matching";

const JAI = { lat: 26.8242, lng: 75.8122 };
const LANDS = "2026-10-12T14:00:00+05:30";
const plusMin = (m: number) => new Date(new Date(LANDS).getTime() + m * 60_000).toISOString();

// Real Jaipur spots.
const PLACES = {
  mansarovarA: { lat: 26.8686, lng: 75.757 },
  mansarovarB: { lat: 26.875, lng: 75.76 }, // ~0.8 km from A, same zone
  malviyaNagar: { lat: 26.8536, lng: 75.8155 },
  tonkRoad: { lat: 26.847, lng: 75.803 }, // ~1.4 km from Malviya Nagar, different zone
  cScheme: { lat: 26.911, lng: 75.8 }, // ~6.5 km from Malviya Nagar
  jagatpura: { lat: 26.827, lng: 75.859 }, // ~10 km from Mansarovar
  vaishaliNagar: { lat: 26.912, lng: 75.743 }, // ~10 km from Malviya Nagar
  outsideA: { lat: 26.95, lng: 75.7 }, // north-west, outside every zone
  outsideB: { lat: 26.955, lng: 75.705 }, // ~0.7 km from outsideA
};

function req(over: Partial<MatchRequest> = {}): MatchRequest {
  return {
    userId: "me",
    airportIata: "JAI",
    arrivalAt: LANDS,
    pax: 1,
    flight: "6E2134",
    womenOnly: false,
    verified: true,
    gender: "M",
    ...PLACES.mansarovarA,
    ...over,
  };
}

function member(over: Partial<CandidateMember> = {}): CandidateMember {
  return {
    userId: `u${Math.random()}`,
    arrivalAt: LANDS,
    pax: 1,
    flight: "AI487",
    verified: true,
    gender: "M",
    ...PLACES.mansarovarB,
    ...over,
  };
}

function pool(over: Partial<CandidatePool> = {}, members = [member()]): CandidatePool {
  return { id: "p1", airportIata: "JAI", status: "open", womenOnly: false, maxPax: 4, hostFirstName: "Asha", members, ...over };
}

const why = (r: ReturnType<typeof evaluate>) => ("rejected" in r ? r.rejected : r.match.type);

describe("Jaipur zones config", () => {
  it("defines the eight launch zones", () => {
    expect(ZONES.JAI.map((z) => z.name)).toEqual([
      "Mansarovar",
      "Malviya Nagar",
      "Jagatpura",
      "Vaishali Nagar",
      "C Scheme",
      "Raja Park",
      "Tonk Road",
      "Sitapura",
    ]);
  });

  it("puts a drop in its nearest zone, or none when outside all of them", () => {
    expect(zoneFor("JAI", PLACES.mansarovarB)?.name).toBe("Mansarovar");
    expect(zoneFor("JAI", PLACES.tonkRoad)?.name).toBe("Tonk Road");
    expect(zoneFor("JAI", PLACES.outsideA)).toBeNull();
    expect(zoneFor("BOM", PLACES.mansarovarA)).toBeNull();
  });
});

describe("match tiers", () => {
  it("tier 1, same area: same zone and within 2 km", () => {
    expect(kmBetween(PLACES.mansarovarA, PLACES.mansarovarB)).toBeLessThan(2);
    const r = evaluate(req(), pool(), JAI);
    expect(why(r)).toBe("same_area");
    expect("match" in r && r.match.tier).toBe(1);
    expect("match" in r && r.match.label).toBe("Same area");
  });

  it("outside named zones, two drops within 2 km still count as the same area", () => {
    expect(why(evaluate(req(PLACES.outsideA), pool({}, [member(PLACES.outsideB)]), JAI))).toBe("same_area");
  });

  it("tier 2, on your route: within 5 km even across zones", () => {
    const km = kmBetween(PLACES.malviyaNagar, PLACES.tonkRoad);
    expect(km).toBeLessThan(MATCH_RULES.SAME_AREA_KM); // close, but a different zone…
    const r = evaluate(req(PLACES.malviyaNagar), pool({}, [member(PLACES.tonkRoad)]), JAI);
    expect(why(r)).toBe("on_route"); // …so it isn't "same area"
  });

  it("tier 3, nearby zone: 5–7 km apart", () => {
    const km = kmBetween(PLACES.malviyaNagar, PLACES.cScheme);
    expect(km).toBeGreaterThan(MATCH_RULES.ON_ROUTE_KM);
    expect(km).toBeLessThanOrEqual(MATCH_RULES.MAX_MATCH_KM);
    expect(why(evaluate(req(PLACES.malviyaNagar), pool({}, [member(PLACES.cScheme)]), JAI))).toBe("nearby_zone");
  });

  it("never matches drops more than 7 km apart", () => {
    expect(kmBetween(PLACES.mansarovarA, PLACES.jagatpura)).toBeGreaterThan(MATCH_RULES.MAX_MATCH_KM);
    expect(why(evaluate(req(), pool({}, [member(PLACES.jagatpura)]), JAI))).toBe("too_far");
  });

  it("uses the furthest rider, so one far-off member breaks the match", () => {
    const r = evaluate(req(), pool({}, [member(), member(PLACES.jagatpura)]), JAI);
    expect(why(r)).toBe("too_far");
  });
});

describe("hard filters", () => {
  it("needs the same airport", () => {
    expect(why(evaluate(req(), pool({ airportIata: "DEL" }), JAI))).toBe("different_airport");
  });

  it("needs everyone to land within 45 minutes", () => {
    expect(why(evaluate(req(), pool({}, [member({ arrivalAt: plusMin(45) })]), JAI))).toBe("same_area");
    expect(why(evaluate(req(), pool({}, [member({ arrivalAt: plusMin(46) })]), JAI))).toBe("arrival_window");
    expect(why(evaluate(req(), pool({}, [member({ arrivalAt: plusMin(-50) })]), JAI))).toBe("arrival_window");
  });

  it("only matches verified riders on both sides", () => {
    expect(why(evaluate(req({ verified: false }), pool(), JAI))).toBe("requester_unverified");
    expect(why(evaluate(req(), pool({}, [member({ verified: false })]), JAI))).toBe("unverified_member");
  });

  it("skips closed pools and pools you're already in", () => {
    expect(why(evaluate(req(), pool({ status: "locked" }), JAI))).toBe("not_open");
    expect(why(evaluate(req(), pool({}, [member({ userId: "me" })]), JAI))).toBe("already_member");
  });

  it("never exceeds the largest car (6 seats), whatever max_pax says", () => {
    const five = [member({ pax: 3 }), member({ pax: 2 })];
    expect(why(evaluate(req({ pax: 1 }), pool({ maxPax: 7 }, five), JAI))).toBe("same_area");
    expect(why(evaluate(req({ pax: 2 }), pool({ maxPax: 7 }, five), JAI))).toBe("full");
    expect(why(evaluate(req({ pax: 1 }), pool({ maxPax: 4 }, [member({ pax: 4 })]), JAI))).toBe("full");
  });
});

describe("women-only rules", () => {
  const woman = (over: Partial<CandidateMember> = {}) => member({ gender: "F", ...over });

  it("a women-only request matches only women-only groups of verified women", () => {
    const me = req({ gender: "F", womenOnly: true });
    expect(why(evaluate(me, pool({ womenOnly: true }, [woman()]), JAI))).toBe("same_area");
    expect(why(evaluate(me, pool({ womenOnly: false }, [woman()]), JAI))).toBe("women_only_request");
    expect(why(evaluate(me, pool({ womenOnly: false }, [member()]), JAI))).toBe("women_only_request");
    expect(why(evaluate(me, pool({ womenOnly: true }, [woman({ verified: false })]), JAI))).toBe("unverified_member");
  });

  it("a women-only group never accepts men", () => {
    expect(why(evaluate(req({ gender: "M" }), pool({ womenOnly: true }, [woman()]), JAI))).toBe("women_only_pool");
    expect(why(evaluate(req({ gender: "T" }), pool({ womenOnly: true }, [woman()]), JAI))).toBe("women_only_pool");
    expect(why(evaluate(req({ gender: null }), pool({ womenOnly: true }, [woman()]), JAI))).toBe("women_only_pool");
  });

  it("a verified woman without the women-only flag can still join a women-only group", () => {
    expect(why(evaluate(req({ gender: "F" }), pool({ womenOnly: true }, [woman()]), JAI))).toBe("same_area");
  });

  it("labels women-only matches", () => {
    const r = evaluate(req({ gender: "F", womenOnly: true }), pool({ womenOnly: true }, [woman()]), JAI);
    expect("match" in r && r.match.womenOnly).toBe(true);
  });
});

describe("ranking and drop order", () => {
  it("orders by tier, then same flight, then distance", () => {
    const pools = [
      pool({ id: "tier3" }, [member(PLACES.cScheme)]),
      pool({ id: "tier2" }, [member(PLACES.tonkRoad)]),
      pool({ id: "tier2-same-flight" }, [member({ ...PLACES.tonkRoad, flight: "6E2134" })]),
      pool({ id: "too-far" }, [member(PLACES.vaishaliNagar)]),
    ];
    expect(kmBetween(PLACES.malviyaNagar, PLACES.vaishaliNagar)).toBeGreaterThan(MATCH_RULES.MAX_MATCH_KM);
    const ranked = findMatches(req(PLACES.malviyaNagar), pools, JAI).map((m) => m.poolId);
    expect(ranked).toEqual(["tier2-same-flight", "tier2", "tier3"]);
  });

  it("drops whoever is closer to the airport first", () => {
    // Tonk Road is closer to the airport than Malviya Nagar.
    expect(kmBetween(JAI, PLACES.tonkRoad)).toBeLessThan(kmBetween(JAI, PLACES.malviyaNagar));
    const r = evaluate(req(PLACES.malviyaNagar), pool({}, [member(PLACES.tonkRoad)]), JAI);
    expect("match" in r && r.match.dropPosition).toBe(2);
    const r2 = evaluate(req(PLACES.tonkRoad), pool({}, [member(PLACES.malviyaNagar)]), JAI);
    expect("match" in r2 && r2.match.dropPosition).toBe(1);
  });

  it("reports zone names, never addresses", () => {
    const r = evaluate(req(PLACES.malviyaNagar), pool({}, [member(PLACES.tonkRoad)]), JAI);
    expect("match" in r && r.match.zones).toEqual(["Tonk Road"]);
  });
});
