import Link from "next/link";
import { buttonClass } from "@/components/ui";

const POINTS = [
  { t: "Same flight", d: "We match you with verified people landing within an hour of you." },
  { t: "Same direction", d: "Only riders heading to your part of town, with the best drop order planned." },
  { t: "Split the cab", d: "Fair, distance-based shares, paid back in one tap over UPI." },
];

export default function Landing() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
      <div className="flex flex-1 flex-col justify-center">
        <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.25em] text-muted">
          <span className="inline-block size-2 rounded-full bg-accent" /> Arrivals · Ground transport
        </div>

        <h1 className="mt-6 text-6xl font-bold tracking-tight">
          Air<span className="text-accent">pool</span>
        </h1>
        <p className="mt-4 text-2xl font-semibold leading-snug">
          Same flight, same direction.
          <br />
          <span className="text-accent">Split the cab.</span>
        </p>

        <div className="mt-10 grid gap-3">
          <Link href="/signup" className={buttonClass("primary", true)}>
            Sign up
          </Link>
          <Link href="/login" className={buttonClass("outline", true)}>
            Log in
          </Link>
        </div>

        <ul className="mt-12 grid gap-3">
          {POINTS.map((p, i) => (
            <li key={p.t} className="flex gap-4 rounded-2xl border border-line bg-surface p-4">
              <span className="w-5 shrink-0 font-mono text-sm tabular-nums text-accent">0{i + 1}</span>
              <div>
                <h2 className="font-semibold">{p.t}</h2>
                <p className="mt-0.5 text-sm text-muted">{p.d}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <footer className="mt-10 text-center text-xs text-muted">Aadhaar-verified riders · Women-only pools · ₹0 to use</footer>
    </main>
  );
}
