import { describe, expect, it } from "vitest";
import { dropArea, formatPhone, groupMessage, whatsappLink } from "./share";

describe("dropArea", () => {
  it("uses the named zone when there is one", () => {
    expect(dropArea("JAI", "jai-mansarovar", "12 Shipra Path, Mansarovar, Jaipur, Rajasthan")).toBe("Mansarovar");
  });
  it("falls back to the locality, never the street address", () => {
    expect(dropArea("JAI", "other", "Hawa Mahal, Ramganj, Jaipur, Rajasthan")).toBe("Ramganj");
    expect(dropArea("BOM", null, "Bandra West")).toBe("Bandra West");
  });
});

describe("groupMessage", () => {
  const msg = groupMessage({
    airportName: "Jaipur Intl",
    airportIata: "JAI",
    day: "Mon, 12 Oct",
    car: { label: "SUV", uber: "Uber XL", ola: "Ola Prime SUV" },
    meeting: { point: "arrival_gate", note: "Gate 2, near Costa" },
    riders: [
      { name: "Asha Verma", phone: "9876543210", flight: "6E2134", landsAt: "2026-10-12T14:00:00+05:30", area: "Tonk Road" },
      { name: "Bea Rao", phone: "9123456780", flight: "AI487", landsAt: "2026-10-12T14:30:00+05:30", area: "Malviya Nagar" },
    ],
  });

  it("has names, phones, flights, route, car and meeting point", () => {
    expect(msg).toContain("1. Asha Verma · +91 98765 43210 · drop: Tonk Road");
    expect(msg).toContain("2. Bea Rao · +91 91234 56780 · drop: Malviya Nagar");
    expect(msg).toContain("• 6E2134 → JAI, lands 2:00 pm (Asha)");
    expect(msg).toContain("Route: JAI airport → Tonk Road → Malviya Nagar");
    expect(msg).toContain("Car: SUV (Uber XL / Ola Prime SUV)");
    expect(msg).toContain("Meeting point: Arrival gate: Gate 2, near Costa");
    expect(msg).toContain("Emergency: 112");
  });

  it("encodes safely into a WhatsApp link", () => {
    const url = whatsappLink(msg);
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1])).toBe(msg);
  });

  it("formats phones", () => {
    expect(formatPhone("9876543210")).toBe("+91 98765 43210");
  });
});
