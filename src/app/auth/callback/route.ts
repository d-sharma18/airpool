import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/validation";

// Landing spot for Google sign-in and email-verification links.
export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  const fail = (msg: string) => NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(msg)}`);

  if (searchParams.get("error_code") === "otp_expired") {
    return fail("That verification link has expired. Log in to get a new one.");
  }
  if (!code) return fail(searchParams.get("error_description") ?? "That sign-in link is invalid.");

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // PKCE links must be opened in the same browser that requested them.
    return fail("Couldn't finish signing in. Open the link in the same browser you signed up with, or log in again.");
  }
  return NextResponse.redirect(`${origin}${next}`);
}
