import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import VerifyFlow from "./verify-flow";

export default async function VerifyPage() {
  const { profile } = await requireUser();
  if (profile.aadhaar_verified) redirect("/dashboard");
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Verify once with Aadhaar</h1>
      <p className="mt-2 text-sm text-muted">
        Everyone on Airpool is verified, so you always know who you&apos;re riding with. Your Aadhaar file is read on
        this phone. We keep only your name, gender, birth year and a one-way hash, never your number or address.
      </p>
      <VerifyFlow />
    </div>
  );
}
