import Link from "next/link";
import { Badge, Card, buttonClass } from "@/components/ui";
import { fmtDay } from "@/lib/format";
import { isAdmin } from "@/lib/admin";
import { requireUser } from "@/lib/session";
import ProfileForm from "./profile-form";

const GENDER = { F: "Female", M: "Male", T: "Transgender" } as const;

export default async function ProfilePage() {
  const { user, profile } = await requireUser();

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold tracking-tight">Profile</h1>

      <Card className="grid gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Aadhaar verification</h2>
          {profile.verified ? <Badge tone="ok">✓ Verified</Badge> : <Badge tone="danger">Not verified</Badge>}
        </div>
        {profile.verified ? (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted">Name</dt>
              <dd>{profile.verified_name}</dd>
              <dt className="text-muted">Gender</dt>
              <dd>{profile.verified_gender ? GENDER[profile.verified_gender] : "-"}</dd>
              <dt className="text-muted">Aadhaar</dt>
              <dd className="font-mono">XXXX XXXX {profile.aadhaar_last4}</dd>
              <dt className="text-muted">Verified on</dt>
              <dd>{profile.verified_at ? fmtDay(profile.verified_at) : "-"}</dd>
            </dl>
            <div className="flex flex-wrap gap-2">
              {profile.is_demo ? (
                <Badge tone="accent">Demo account · no real Aadhaar</Badge>
              ) : profile.aadhaar_signature_ok ? (
                <Badge tone="ok">UIDAI signature ✓</Badge>
              ) : (
                <Badge tone="accent">Demo mode</Badge>
              )}
              {profile.phone_verified && <Badge tone="ok">Phone matches Aadhaar</Badge>}
              {profile.face_match_score != null && <Badge>Face match {Math.round(profile.face_match_score * 100)}%</Badge>}
              {profile.verified_gender === "F" && <Badge tone="women">Women-only pools unlocked</Badge>}
            </div>
            <p className="text-xs text-muted">These details come from UIDAI and can&apos;t be edited.</p>
          </>
        ) : (
          <Link href="/verify" className={buttonClass("primary", true)}>
            Verify Aadhaar
          </Link>
        )}
      </Card>

      <ProfileForm
        userId={user.id}
        email={user.email ?? ""}
        fullName={profile.full_name ?? ""}
        phone={profile.phone ?? ""}
        upi={profile.upi_id ?? ""}
        phoneLocked={profile.verified}
      />

      {isAdmin(user.email) && (
        <Link href="/admin" className={buttonClass("ghost", true)}>
          🛡️ Admin · safety reports
        </Link>
      )}

      <form action="/logout" method="post">
        <button className={buttonClass("outline", true)}>Log out</button>
      </form>
    </div>
  );
}
