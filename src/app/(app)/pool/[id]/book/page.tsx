import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, buttonClass } from "@/components/ui";
import { requireUser } from "@/lib/session";
import type { Pool, PoolMember } from "@/lib/types";
import type { Contact, Person } from "../pool-view";
import BookView from "./book-view";

/** Booking & payments for a locked group. */
export default async function BookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await requireUser({ verified: true });

  const { data: pool } = await supabase.from("pools").select("*").eq("id", id).maybeSingle<Pool>();
  if (!pool) notFound();

  if (pool.status !== "locked" && pool.status !== "completed") {
    return (
      <div className="grid gap-4">
        <Card className="text-sm text-muted">Booking opens once everyone has accepted and the group is locked.</Card>
        <Link href={`/pool/${id}`} className={buttonClass("ghost", true)}>
          Back to group
        </Link>
      </div>
    );
  }

  const [{ data: members }, { data: people }, { data: contacts }] = await Promise.all([
    supabase.from("pool_members").select("*").eq("pool_id", id).order("joined_at").returns<PoolMember[]>(),
    supabase.rpc("get_pool_people", { p_pool: id }),
    supabase.rpc("get_pool_contacts", { p_pool: id }),
  ]);

  return (
    <BookView
      me={user.id}
      pool={pool}
      members={members ?? []}
      people={(people ?? []) as Person[]}
      contacts={(contacts ?? []) as Contact[]}
    />
  );
}
