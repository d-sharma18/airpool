"use client";

import { useEffect } from "react";
import { Button, Card } from "@/components/ui";

/** Friendly fallback when a page fails to load (offline, server hiccup, expired session…). */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  return (
    <Card className="grid gap-3 text-center">
      <p className="text-3xl" aria-hidden>
        {offline ? "📡" : "🛬"}
      </p>
      <p className="font-semibold">{offline ? "You're offline" : "Something went wrong"}</p>
      <p className="text-sm text-muted">
        {offline ? "Check your connection. We'll pick up where you left off." : "This page didn't load. It's usually a blip; try again."}
      </p>
      <Button onClick={reset} full>
        Try again
      </Button>
    </Card>
  );
}
