import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recommendVehicle } from "./vehicle-ai";

const group = [{ pax: 2, checked: 2, cabin: 0 }, { pax: 2, checked: 2, cabin: 0 }]; // rules: SUV
const ctx = { city: "Jaipur", km: 14 };
const answer = { car_type: "suv", confidence: 0.9, reason: "4 people with 4 big bags won't fit in a sedan boot. Take an SUV." };

const gemini = (status: number, body?: unknown) =>
  new Response(JSON.stringify(body ?? { candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }), { status });
const groq = (status: number, body?: unknown) =>
  new Response(JSON.stringify(body ?? { choices: [{ message: { content: JSON.stringify(answer) } }] }), { status });

describe("Gemini → Groq → rules", () => {
  const calls: string[] = [];
  beforeEach(() => {
    calls.length = 0;
    vi.stubEnv("GEMINI_API_KEY", "test-gemini");
    vi.stubEnv("GROQ_API_KEY", "test-groq");
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const route = (g: () => Response, q: () => Response) =>
    vi.stubGlobal("fetch", async (url: string) => {
      const host = new URL(url).host;
      calls.push(host);
      return host.includes("googleapis") ? g() : q();
    });

  it("uses Gemini when it answers", async () => {
    route(() => gemini(200), () => groq(200));
    const r = await recommendVehicle(group, ctx);
    expect(r).toMatchObject({ vehicle: "suv", source: "gemini", confidence: 0.9 });
    expect(calls).toEqual(["generativelanguage.googleapis.com"]);
  });

  it("falls back to Groq when Gemini is rate-limited (429)", async () => {
    route(() => gemini(429, { error: { message: "quota" } }), () => groq(200));
    const r = await recommendVehicle(group, ctx);
    expect(r.source).toBe("groq");
    expect(calls).toEqual(["generativelanguage.googleapis.com", "api.groq.com"]);
  });

  it("falls back to Groq when Gemini returns junk", async () => {
    route(() => gemini(200, { candidates: [{ content: { parts: [{ text: "Sure! An SUV." }] } }] }), () => groq(200));
    expect((await recommendVehicle(group, ctx)).source).toBe("groq");
  });

  it("uses the rules when both fail", async () => {
    route(() => gemini(503), () => groq(429));
    const r = await recommendVehicle(group, ctx);
    expect(r).toMatchObject({ vehicle: "suv", source: "rules" });
    expect(r.reason).toBe("4 people with 4 bags won't fit in a Sedan boot (3 bags). Take an SUV.");
  });

  it("uses the rules with no keys configured, without calling anyone", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "");
    route(() => gemini(200), () => groq(200));
    expect((await recommendVehicle(group, ctx)).source).toBe("rules");
    expect(calls).toEqual([]);
  });

  it("sends the key in a header, never in the URL", async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen = { url, headers: init.headers as Record<string, string> };
      return gemini(200);
    });
    await recommendVehicle(group, ctx);
    expect(seen!.url).not.toContain("test-gemini");
    expect(seen!.headers["x-goog-api-key"]).toBe("test-gemini");
  });
});
