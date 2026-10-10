import { requireUser } from "@/lib/session";
import TripForm from "./trip-form";

export default async function NewTripPage() {
  const { profile } = await requireUser({ verified: true });
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Plan a shared ride</h1>
      <p className="mt-1 text-sm text-muted">Tell us when you land and where you&apos;re headed.</p>
      <TripForm canWomenOnly={profile.gender === "F"} />
    </div>
  );
}
