"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

const ITEMS = [
  { href: "/dashboard", label: "Rides", icon: "M3 12h18M3 6h18M3 18h12" },
  { href: "/trip/new", label: "New trip", icon: "M12 5v14M5 12h14" },
  { href: "/profile", label: "Profile", icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0" },
];

export default function BottomNav() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-[1000] border-t border-line bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto grid max-w-md grid-cols-3">
        {ITEMS.map((it) => {
          const active = path.startsWith(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              className={cx("flex h-16 flex-col items-center justify-center gap-1 text-xs", active ? "text-accent" : "text-muted")}
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d={it.icon} />
              </svg>
              {it.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
