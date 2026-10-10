import { notFound } from "next/navigation";
import { Badge, Card } from "@/components/ui";
import { isAdmin } from "@/lib/admin";
import { fmtDay, fmtTime } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/server";
import { REPORT_REASONS } from "@/lib/reports";
import AdminActions from "./admin-actions";

export const dynamic = "force-dynamic";

interface Person {
  id: string;
  verified_name: string | null;
  full_name: string | null;
  email: string | null;
  verified_gender: string | null;
  women_only_blocked: boolean;
  blocked: boolean;
  flagged_at: string | null;
}
interface ReportRow {
  id: number;
  pool_id: string;
  reason: string;
  note: string | null;
  women_only_ride: boolean;
  status: "open" | "actioned" | "dismissed";
  created_at: string;
  reporter: Person | null;
  reported: Person | null;
}

const reasonLabel = (r: string) => REPORT_REASONS.find((x) => x.value === r)?.label ?? r;
const nameOf = (p: Person | null) => p?.verified_name ?? p?.full_name ?? p?.email ?? "Unknown";
const PERSON = "id, verified_name, full_name, email, verified_gender, women_only_blocked, blocked, flagged_at";

/** Simple moderation page: reports first, then flagged and blocked users. Hidden from non-admins. */
export default async function AdminPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { user } = await requireUser();
  if (!isAdmin(user.email)) notFound();
  const show = (await searchParams).show === "all" ? "all" : "open";

  const db = createAdminClient();
  let q = db
    .from("reports")
    .select(`id, pool_id, reason, note, women_only_ride, status, created_at, reporter:profiles!reports_reporter_id_fkey(${PERSON}), reported:profiles!reports_reported_id_fkey(${PERSON})`)
    .order("created_at", { ascending: false })
    .limit(100);
  if (show === "open") q = q.eq("status", "open");
  const [{ data: reports }, { data: flagged }, { count: openCount }] = await Promise.all([
    q.returns<ReportRow[]>(),
    db.from("profiles").select(PERSON).or("flagged_at.not.is.null,blocked.eq.true").order("flagged_at", { ascending: false }).limit(100).returns<Person[]>(),
    db.from("reports").select("id", { count: "exact", head: true }).eq("status", "open"),
  ]);

  return (
    <div className="grid grid-cols-1 gap-5 pb-6">
      <section>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Admin</p>
        <h1 className="text-2xl font-bold tracking-tight">Safety reports</h1>
        <div className="mt-2 flex gap-2 text-sm">
          <a href="/admin" className={show === "open" ? "text-accent underline" : "text-muted underline"}>
            Open ({openCount ?? 0})
          </a>
          <a href="/admin?show=all" className={show === "all" ? "text-accent underline" : "text-muted underline"}>
            All
          </a>
        </div>
      </section>

      {(reports ?? []).length === 0 && <Card className="text-sm text-muted">No {show === "open" ? "open " : ""}reports. All quiet. 🎉</Card>}

      {(reports ?? []).map((r) => (
        <Card key={r.id} className="grid grid-cols-1 gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={r.status === "open" ? "danger" : "muted"}>{r.status}</Badge>
            <Badge>{reasonLabel(r.reason)}</Badge>
            {r.women_only_ride && <Badge tone="women">Women-only ride</Badge>}
            <span className="text-xs text-muted">
              {fmtDay(r.created_at)} {fmtTime(r.created_at)}
            </span>
          </div>
          <p className="text-sm">
            <span className="font-semibold">{nameOf(r.reported)}</span>{" "}
            <span className="text-muted">({r.reported?.email}) reported by</span> {nameOf(r.reporter)}
          </p>
          {r.note && <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm">“{r.note}”</p>}
          <div className="flex flex-wrap gap-2 text-xs">
            {r.reported?.women_only_blocked && <Badge tone="women">women-only access removed</Badge>}
            {r.reported?.blocked && <Badge tone="danger">blocked</Badge>}
          </div>
          {r.reported && (
            <AdminActions
              reportId={r.id}
              userId={r.reported.id}
              blocked={r.reported.blocked}
              womenOnlyBlocked={r.reported.women_only_blocked}
              open={r.status === "open"}
            />
          )}
        </Card>
      ))}

      <section className="grid gap-3">
        <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Flagged &amp; blocked users</h2>
        {(flagged ?? []).length === 0 && <p className="text-sm text-muted">Nobody flagged.</p>}
        {(flagged ?? []).map((p) => (
          <Card key={p.id} className="grid grid-cols-1 gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                {nameOf(p)} <span className="text-xs text-muted">{p.email}</span>
              </p>
              <div className="flex gap-1.5">
                {p.blocked && <Badge tone="danger">blocked</Badge>}
                {p.women_only_blocked && <Badge tone="women">no women-only</Badge>}
              </div>
            </div>
            {p.flagged_at && <p className="text-xs text-muted">Flagged {fmtDay(p.flagged_at)}</p>}
            <AdminActions userId={p.id} blocked={p.blocked} womenOnlyBlocked={p.women_only_blocked} open={false} />
          </Card>
        ))}
      </section>
    </div>
  );
}
