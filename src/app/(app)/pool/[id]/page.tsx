import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import type { Pool, PoolMember } from "@/lib/types";
import PoolView, { type Contact, type Message, type Person } from "./pool-view";

export default async function PoolPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await requireUser({ verified: true });

  const { data: pool } = await supabase.from("pools").select("*").eq("id", id).maybeSingle<Pool>();
  if (!pool) notFound();

  const [{ data: members }, { data: messages }, contactsRes, { data: myTrip }, { data: myConfirm }] = await Promise.all([
    supabase.from("pool_members").select("*").eq("pool_id", id).order("joined_at").returns<PoolMember[]>(),
    supabase
      .from("messages")
      .select("id, user_id, body, created_at")
      .eq("pool_id", id)
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<Message[]>(),
    pool.status === "locked" || pool.status === "completed"
      ? supabase.rpc("get_pool_contacts", { p_pool: id })
      : Promise.resolve({ data: [] }),
    supabase.from("trip_requests").select("notify_on_match").eq("pool_id", id).eq("user_id", user.id).maybeSingle(),
    supabase.from("ride_confirmations").select("all_women").eq("pool_id", id).eq("user_id", user.id).maybeSingle(),
  ]);

  // Profiles are owner-only under RLS; co-riders get a safe subset through this RPC.
  const { data } = await supabase.rpc("get_pool_people", { p_pool: id });
  const people = (data ?? []) as Person[];

  const paths = people.map((p) => p.avatar_path).filter((p): p is string => !!p);
  const { data: signed } = paths.length
    ? await supabase.storage.from("selfies").createSignedUrls(paths, 3600)
    : { data: [] };
  const avatarByPath = Object.fromEntries((signed ?? []).map((s) => [s.path, s.signedUrl]));

  return (
    <PoolView
      me={user.id}
      pool={pool}
      members={members ?? []}
      people={people.map((p) => ({ ...p, avatar_url: p.avatar_path ? avatarByPath[p.avatar_path] ?? null : null }))}
      contacts={(contactsRes.data ?? []) as Contact[]}
      initialMessages={(messages ?? []).reverse()}
      notifyOnMatch={!!myTrip?.notify_on_match}
      myConfirmation={myConfirm ? myConfirm.all_women : null}
    />
  );
}
