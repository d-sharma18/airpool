import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import type { Pool } from "@/lib/types";
import FareBreakdownView from "./view";

/** Who pays what, and why: distance, amount and a one-line reason per rider, in drop order. */
export default async function FareBreakdown({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await requireUser({ verified: true });
  const { data: pool } = await supabase.from("pools").select("*").eq("id", id).maybeSingle<Pool>();
  if (!pool) notFound();
  const { data } = await supabase.rpc("get_pool_people", { p_pool: id });
  return <FareBreakdownView pool={pool} me={user.id} people={(data ?? []) as { id: string; name: string | null }[]} />;
}
