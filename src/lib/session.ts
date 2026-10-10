import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import type { Profile } from "./types";

export async function requireUser(opts: { verified?: boolean } = {}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single<Profile>();
  if (opts.verified && !profile?.aadhaar_verified) redirect("/verify");
  return { supabase, user, profile: profile! };
}
