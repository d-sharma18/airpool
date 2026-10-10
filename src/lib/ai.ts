import "server-only";
import { createHash } from "node:crypto";
import { allow } from "./rate-limit";
import { createAdminClient } from "./supabase/server";

export type AiSource = "gemini" | "groq";

const SYSTEM =
  "You are the planning assistant for Airpool, an Indian airport cab-sharing app. " +
  "Reply with a single JSON object only, matching the requested shape. Amounts are in INR.";

async function gemini(prompt: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("no gemini key");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
}

async function groq(prompt: string): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("no groq key");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`groq ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

const PROVIDERS = { gemini, groq } as const;

/** Stay inside each provider's free tier: skip it (and fall back) once today's budget is used. */
async function withinBudget(source: AiSource) {
  if (source === "gemini") return (await allow("geminiMinute")) && (await allow("geminiDay"));
  return allow("groqDay");
}

const hasDb = () => !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const keyFor = (prompt: string, providers: readonly AiSource[]) =>
  createHash("sha256").update(`${providers.join(",")}|${prompt}`).digest("hex");

async function cached<T>(key: string): Promise<{ data: T; source: AiSource } | null> {
  if (!hasDb()) return null;
  const { data } = await createAdminClient().from("ai_cache").select("source, result").eq("key", key).maybeSingle();
  return data ? { data: data.result as T, source: data.source as AiSource } : null;
}

/**
 * Ask Gemini, then Groq (or only the providers given). Returns null if all fail,
 * so callers can fall back to rules.
 */
export async function askJson<T>(
  prompt: string,
  opts: { providers?: AiSource[]; cache?: boolean } = {},
): Promise<{ data: T; source: AiSource } | null> {
  const providers = opts.providers ?? (["gemini", "groq"] as const);
  // Identical prompts (same group, same route) get the stored answer instead of a new API call.
  const key = keyFor(prompt, providers);
  if (opts.cache !== false) {
    const hit = await cached<T>(key).catch(() => null);
    if (hit) return hit;
  }

  for (const source of providers) {
    const call = PROVIDERS[source];
    try {
      if (!(await withinBudget(source))) throw new Error("free quota for today used up");
      const text = await call(prompt);
      const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
      const data = JSON.parse(json) as T;
      if (opts.cache !== false && hasDb()) {
        await createAdminClient().from("ai_cache").upsert({ key, source, result: data }).then(undefined, () => {});
      }
      return { data, source };
    } catch (e) {
      console.warn(`[ai] ${source} failed:`, (e as Error).message);
    }
  }
  return null;
}
