import { NextResponse, type NextRequest } from "next/server";
import { isAdmin } from "@/lib/admin";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Action = "block" | "unblock" | "dismiss" | "actioned" | "restore_women_only";

/** Admin actions on reports and users. Only emails in ADMIN_EMAILS may call this. */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdmin(user.email)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  const { action, userId, reportId, note } = (await req.json().catch(() => ({}))) as {
    action?: Action;
    userId?: string;
    reportId?: number;
    note?: string;
  };
  const db = createAdminClient();
  const now = new Date().toISOString();

  switch (action) {
    case "block":
    case "unblock": {
      if (!userId) return NextResponse.json({ error: "Missing user" }, { status: 400 });
      if (userId === user.id) return NextResponse.json({ error: "You can't block yourself" }, { status: 400 });
      const blocked = action === "block";
      const { error } = await db.from("profiles").update({ blocked }).eq("id", userId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      // Ban at the auth level too, so they can't sign in again (~100 years).
      await db.auth.admin.updateUserById(userId, { ban_duration: blocked ? "876000h" : "none" });
      if (blocked && reportId) await db.from("reports").update({ status: "actioned", reviewed_at: now, admin_note: note ?? null }).eq("id", reportId);
      break;
    }
    case "restore_women_only": {
      if (!userId) return NextResponse.json({ error: "Missing user" }, { status: 400 });
      await db.from("profiles").update({ women_only_blocked: false }).eq("id", userId);
      break;
    }
    case "dismiss":
    case "actioned": {
      if (!reportId) return NextResponse.json({ error: "Missing report" }, { status: 400 });
      await db
        .from("reports")
        .update({ status: action === "dismiss" ? "dismissed" : "actioned", reviewed_at: now, admin_note: note ?? null })
        .eq("id", reportId);
      break;
    }
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
