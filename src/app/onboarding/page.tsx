import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { profileComplete, requireUser } from "@/lib/session";
import OnboardingForm from "./onboarding-form";

export default async function OnboardingPage() {
  const { user, profile } = await requireUser({ allowIncomplete: true });
  if (profileComplete(profile)) redirect("/dashboard");
  return (
    <AuthShell title="A few more details" subtitle="We need these before you can share a ride.">
      <OnboardingForm
        userId={user.id}
        fullName={profile.full_name ?? ""}
        phone={profile.phone ?? ""}
        upi={profile.upi_id ?? ""}
      />
      <form action="/logout" method="post" className="mt-6 text-center">
        <button className="text-sm text-muted underline">Log out</button>
      </form>
    </AuthShell>
  );
}
