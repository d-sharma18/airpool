import Link from "next/link";
import { Badge, Card, buttonClass } from "@/components/ui";
import { requireUser } from "@/lib/session";
import ProfileForm from "./profile-form";

export default async function ProfilePage() {
  const { supabase, user, profile } = await requireUser();
  const { data: priv } = await supabase
    .from("profile_private")
    .select("phone, phone_verified, aadhaar_last4")
    .eq("user_id", user.id)
    .maybeSingle();

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold tracking-tight">Profile</h1>

      <Card className="grid gap-2">
        <div className="flex items-center justify-between">
          <p className="text-lg font-semibold">{profile.full_name ?? user.email}</p>
          {profile.aadhaar_verified ? <Badge tone="ok">✓ Aadhaar verified</Badge> : <Badge tone="danger">Not verified</Badge>}
        </div>
        <p className="text-sm text-muted">{user.email}</p>
        {profile.aadhaar_verified ? (
          <div className="flex flex-wrap gap-2">
            <Badge>XXXX XXXX {priv?.aadhaar_last4}</Badge>
            <Badge>{profile.gender === "F" ? "Female" : profile.gender === "M" ? "Male" : "Transgender"}</Badge>
            {profile.aadhaar_signature_ok ? <Badge tone="ok">UIDAI signature ✓</Badge> : <Badge tone="accent">Demo mode</Badge>}
            {profile.face_match_score != null && <Badge>Face match {Math.round(profile.face_match_score * 100)}%</Badge>}
            {profile.gender === "F" && <Badge tone="women">Women-only pools unlocked</Badge>}
          </div>
        ) : (
          <Link href="/verify" className={buttonClass("primary", true)}>
            Verify Aadhaar
          </Link>
        )}
      </Card>

      <ProfileForm
        userId={user.id}
        upi={profile.upi_id ?? ""}
        phone={priv?.phone ?? ""}
        phoneVerified={!!priv?.phone_verified}
      />

      <form action="/auth/signout" method="post">
        <button className={buttonClass("outline", true)}>Sign out</button>
      </form>
    </div>
  );
}
