import { AuthShell } from "@/components/auth-shell";

export default function Blocked() {
  return (
    <AuthShell title="Account blocked" subtitle="After a safety review, this account can no longer use Airpool.">
      <p className="text-sm text-muted">If you think this is a mistake, reply to the email you signed up with and we&apos;ll take another look.</p>
      <form action="/logout" method="post" className="mt-6">
        <button className="text-sm text-muted underline">Log out</button>
      </form>
    </AuthShell>
  );
}
