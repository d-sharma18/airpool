import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { MAX_EKYC_AGE_DAYS, ageOn, identityHash, mobileMatches, verifyOfflineXml } from "@/lib/aadhaar-server";

export const runtime = "nodejs";

const FACE_MATCH_MIN = 0.45;

interface Body {
  xml: string;
  shareCode: string;
  phone: string;
  faceScore: number;
  selfiePath: string;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.xml || body.xml.length > 2_000_000) return NextResponse.json({ error: "Missing eKYC XML" }, { status: 400 });
  if (!/^\d{4}$/.test(body.shareCode ?? "")) return NextResponse.json({ error: "Share code must be 4 digits" }, { status: 400 });
  const phone = (body.phone ?? "").replace(/\D/g, "").slice(-10);
  if (!/^[6-9]\d{9}$/.test(phone)) return NextResponse.json({ error: "Enter a valid 10-digit Indian mobile number" }, { status: 400 });
  if (typeof body.faceScore !== "number" || body.faceScore < FACE_MATCH_MIN) {
    return NextResponse.json({ error: "Selfie didn't match the Aadhaar photo" }, { status: 400 });
  }
  if (body.selfiePath !== `${user.id}/selfie.jpg`) return NextResponse.json({ error: "Bad selfie path" }, { status: 400 });

  let a;
  try {
    a = verifyOfflineXml(body.xml);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const ageDays = (Date.now() - a.generatedAt.getTime()) / 86_400_000;
  if (ageDays > MAX_EKYC_AGE_DAYS) {
    return NextResponse.json(
      { error: `This eKYC file is ${Math.floor(ageDays)} days old. Download a fresh one (max ${MAX_EKYC_AGE_DAYS} days).` },
      { status: 400 },
    );
  }
  if (ageOn(a.dob) < 18) return NextResponse.json({ error: "Airpool is for adults (18+) only" }, { status: 400 });

  const admin = createAdminClient();
  const hash = identityHash(a);
  const { data: existing } = await admin
    .from("profile_private")
    .select("user_id")
    .eq("aadhaar_hash", hash)
    .neq("user_id", user.id)
    .maybeSingle();
  if (existing) return NextResponse.json({ error: "This Aadhaar is already linked to another Airpool account" }, { status: 409 });

  const phoneVerified = mobileMatches(a, phone, body.shareCode);

  const { error: e1 } = await admin
    .from("profile_private")
    .update({ phone, phone_verified: phoneVerified, aadhaar_hash: hash, aadhaar_last4: a.last4 })
    .eq("user_id", user.id);
  const { error: e2 } = await admin
    .from("profiles")
    .update({
      full_name: a.name,
      gender: a.gender,
      birth_year: a.birthYear,
      aadhaar_verified: true,
      aadhaar_signature_ok: a.signatureOk,
      face_match_score: Math.round(body.faceScore * 100) / 100,
      verified_at: new Date().toISOString(),
      avatar_path: body.selfiePath,
    })
    .eq("id", user.id);
  if (e1 || e2) return NextResponse.json({ error: (e1 ?? e2)!.message }, { status: 500 });

  // Nothing else from the XML (address, photo, DOB) is stored.
  return NextResponse.json({ ok: true, name: a.name, gender: a.gender, phoneVerified, signatureOk: a.signatureOk });
}
