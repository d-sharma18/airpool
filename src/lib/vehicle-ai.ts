import "server-only";
import { askJson } from "./ai";
import type { VehicleRecommendation } from "./types";
import { pickVehicle, vehiclePrompt, type AiVehicleAnswer, type RiderLoad } from "./vehicle";

/**
 * Gemini Flash first, Groq if Gemini fails or is rate-limited, then the rules.
 * Runs on the server only; the API keys never reach the browser.
 */
export async function recommendVehicle(riders: RiderLoad[], ctx: { city: string; km: number }): Promise<VehicleRecommendation> {
  const ai = await askJson<AiVehicleAnswer>(vehiclePrompt(riders, ctx));
  return pickVehicle(riders, ai);
}
