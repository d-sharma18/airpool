"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-fetches the server page so family see the latest position without reloading. */
export default function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
