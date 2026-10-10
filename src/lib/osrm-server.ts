import "server-only";
import { planDrops, type OsrmDeps, type Point, type RoutePlan } from "./osrm";
import { createAdminClient } from "./supabase/server";

const MAX_WAIT_MS = 15_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * OSRM with a shared 1-request-per-second limit and a permanent cache, both in Supabase,
 * so they hold across every Vercel serverless instance.
 */
export function planDropsShared(airport: Point, stops: Point[]): Promise<RoutePlan> {
  const db = createAdminClient();
  const deps: OsrmDeps = {
    async throttle() {
      // osrm_slot() atomically books the next free second and returns when ours starts.
      const { data, error } = await db.rpc("osrm_slot");
      if (error || !data) return;
      const wait = new Date(data as string).getTime() - Date.now();
      if (wait > MAX_WAIT_MS) throw new Error("OSRM queue too long");
      if (wait > 0) await sleep(wait);
    },
    cache: {
      async get(key) {
        const { data } = await db.from("route_cache").select("result").eq("key", key).maybeSingle();
        return (data?.result as RoutePlan) ?? null;
      },
      async set(key, plan) {
        await db.from("route_cache").upsert({ key, result: plan });
      },
    },
  };
  return planDrops(airport, stops, deps);
}
