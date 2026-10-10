import Link from "next/link";
import BottomNav from "@/components/bottom-nav";
import { Badge } from "@/components/ui";
import { requireUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireUser();
  return (
    <div className="mx-auto min-h-dvh max-w-md pb-24">
      <header className="sticky top-0 z-[1000] flex items-center justify-between border-b border-line bg-bg/90 px-5 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <Link href="/dashboard" className="flex items-center gap-2 font-mono text-sm tracking-widest text-accent">
          <span className="inline-block size-2 rounded-full bg-accent" /> AIRPOOL
        </Link>
        {profile?.verified ? (
          <Badge tone="ok">✓ Verified</Badge>
        ) : (
          <Link href="/verify">
            <Badge tone="accent">Verify Aadhaar →</Badge>
          </Link>
        )}
      </header>
      <main className="px-5 pt-5">{children}</main>
      <BottomNav />
    </div>
  );
}
