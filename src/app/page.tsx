import Link from "next/link";
import { buttonClass } from "@/components/ui";

const FEATURES = [
  { t: "Aadhaar-verified riders", d: "Every rider verifies once with UIDAI's offline eKYC and a live selfie match." },
  { t: "Matched by flight + zone", d: "We pair people landing within an hour of you, heading to the same part of town." },
  { t: "Women-only pools", d: "Verified women can open pools that only other verified women can see or join." },
  { t: "AI picks the car", d: "Riders and luggage go in, the right cab class comes out. No more boot Tetris." },
  { t: "Fair, distance-based split", d: "Each leg's cost is shared by whoever is still in the cab. Pay by UPI in one tap." },
  { t: "Safety lock", d: "Phone numbers unlock only inside a locked group, never on a public profile." },
];

export default function Landing() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10 pt-[max(2rem,env(safe-area-inset-top))]">
      <div className="flex items-center gap-2 font-mono text-sm tracking-widest text-accent">
        <span className="inline-block size-2 rounded-full bg-accent" /> AIRPOOL
      </div>

      <section className="mt-12">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Arrivals · Ground transport</p>
        <h1 className="mt-3 text-4xl font-bold leading-[1.05] tracking-tight">
          Landed? Split the cab home with someone on your flight.
        </h1>
        <p className="mt-4 text-muted">
          Airpool matches verified travellers at the same airport going the same way, plans the drop order and splits
          the fare by distance.
        </p>
        <div className="mt-8 grid gap-3">
          <Link href="/login" className={buttonClass("primary", true)}>
            Get started
          </Link>
          <Link href="/login" className={buttonClass("outline", true)}>
            I already have an account
          </Link>
        </div>
      </section>

      <section className="mt-12 rounded-2xl border border-line bg-surface font-mono text-sm">
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 border-b border-line px-4 py-2 text-[11px] uppercase tracking-wider text-muted">
          <span>To · example fares</span>
          <span>Riders</span>
          <span>You pay</span>
        </div>
        {[
          ["Koramangala", "3", "₹412"],
          ["Bandra West", "2", "₹388"],
          ["Gurugram Sec 29", "4", "₹301"],
        ].map(([to, n, fare]) => (
          <div key={to} className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-4 py-2.5">
            <span className="truncate">{to}</span>
            <span className="text-muted">{n}</span>
            <span className="text-accent">{fare}</span>
          </div>
        ))}
      </section>

      <section className="mt-10 grid gap-3">
        {FEATURES.map((f) => (
          <div key={f.t} className="rounded-2xl border border-line bg-surface p-4">
            <h2 className="font-semibold">{f.t}</h2>
            <p className="mt-1 text-sm text-muted">{f.d}</p>
          </div>
        ))}
      </section>

      <footer className="mt-10 text-center text-xs text-muted">
        Maps © OpenStreetMap contributors · Built for zero cost
      </footer>
    </main>
  );
}
