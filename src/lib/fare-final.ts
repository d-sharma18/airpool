import "server-only";
import { askJson } from "./ai";
import { checkAiSplit, formulaSplit, splitPrompt, type SplitInput } from "./fare";
import type { PoolPlan } from "./types";

/**
 * Split the real fare. Gemini proposes amounts by road distance; we accept them only if they
 * add up exactly and each is within 10% of the formula. Otherwise (or if Gemini is down)
 * the formula is used, with rounding given to the booker.
 */
export async function finalSplit(plan: PoolPlan, total: number, bookerId: string, city: string): Promise<PoolPlan> {
  // Drop order + each rider's road distance from the airport come from the OSRM plan.
  const riders: SplitInput[] = plan.drop_order.map((id) => ({
    user_id: id,
    km: plan.shares.find((s) => s.user_id === id)?.km ?? 0,
  }));
  const labels = riders.map((_, i) => `R${i + 1}`);
  const ids = new Map(labels.map((l, i) => [l, riders[i].user_id]));
  const bookerLabel = labels[riders.findIndex((r) => r.user_id === bookerId)] ?? "R1";

  let shares = formulaSplit(total, riders, bookerId);
  let method: PoolPlan["split_method"] = "formula";
  let note: string | undefined;

  if (riders.length === 1) {
    note = "Only one rider, so they pay the full fare.";
  } else {
    // Gemini only; no names are sent, just R1, R2…
    const ai = await askJson(splitPrompt(total, riders, labels, bookerLabel, city), { providers: ["gemini"] });
    if (!ai) {
      note = "Gemini was unavailable, so we used the distance formula.";
    } else {
      const checked = checkAiSplit(total, riders, ids, ai.data);
      if (checked.ok) {
        shares = riders.map((r) => checked.shares.find((s) => s.user_id === r.user_id)!);
        method = "ai";
      } else {
        note = `Gemini's split failed our check (${checked.why}), so we used the distance formula.`;
        console.warn("[fare] rejected AI split:", checked.why);
      }
    }
  }

  return {
    ...plan,
    fare_total: total,
    fare_source: "actual",
    fare_note: "Final fare entered by the booker.",
    shares,
    split_method: method,
    split_source: method === "ai" ? "gemini" : undefined,
    split_note: note,
    final: true,
  };
}
