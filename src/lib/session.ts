import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import type { Profile } from "./types";

export const profileComplete = (p: Profile | null) => !!(p?.full_name && p.phone && p.upi_id);

export async function requireUser(opts: { verified?: boolean; allowIncomplete?: boolean } = {}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single<Profile>();
  if (profile?.blocked) redirect("/blocked");
  // Google sign-ups arrive without phone / UPI; collect them before anything else.
  if (!opts.allowIncomplete && !profileComplete(profile)) redirect("/onboarding");
  if (opts.verified && !profile?.verified) redirect("/verify");
  return { supabase, user, profile: profile! };
}
