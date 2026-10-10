import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import type { Pool, PoolMember } from "@/lib/types";
import PoolView, { type Contact, type Message, type Person } from "./pool-view";

export default async function PoolPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await requireUser({ verified: true });

  const { data: pool } = await supabase.from("pools").select("*").eq("id", id).maybeSingle<Pool>();
  if (!pool) notFound();

  const [{ data: members }, { data: messages }, contactsRes] = await Promise.all([
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
  ]);

  const ids = (members ?? []).map((m) => m.user_id);
  const { data: people } = await supabase
    .from("profiles")
    .select("id, full_name, gender, aadhaar_verified, aadhaar_signature_ok, avatar_path, upi_id")
    .in("id", ids)
    .returns<Person[]>();

  const paths = (people ?? []).map((p) => p.avatar_path).filter((p): p is string => !!p);
  const { data: signed } = paths.length
    ? await supabase.storage.from("selfies").createSignedUrls(paths, 3600)
    : { data: [] };
  const avatarByPath = Object.fromEntries((signed ?? []).map((s) => [s.path, s.signedUrl]));

  return (
    <PoolView
      me={user.id}
      pool={pool}
      members={members ?? []}
      people={(people ?? []).map((p) => ({ ...p, avatar_url: p.avatar_path ? avatarByPath[p.avatar_path] ?? null : null }))}
      contacts={(contactsRes.data ?? []) as Contact[]}
      initialMessages={(messages ?? []).reverse()}
    />
  );
}
