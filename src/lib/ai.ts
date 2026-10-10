import "server-only";

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

/** Ask Gemini, fall back to Groq. Returns null if both fail so callers can use rules. */
export async function askJson<T>(prompt: string): Promise<{ data: T; source: AiSource } | null> {
  for (const [source, call] of [["gemini", gemini], ["groq", groq]] as const) {
    try {
      const text = await call(prompt);
      const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
      return { data: JSON.parse(json) as T, source };
    } catch (e) {
      console.warn(`[ai] ${source} failed:`, (e as Error).message);
    }
  }
  return null;
}
