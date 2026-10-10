"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toaster";
import { Button, Card, Spinner, buttonClass } from "@/components/ui";
import { whatsappLink } from "@/lib/share";

const UPDATE_EVERY_MS = 20_000;

function currentPosition(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 30_000,
    });
  });
}

/**
 * One tap: grab location, create a private live-location link, open WhatsApp with the link
 * and the group details. Keeps the link updated while this page stays open.
 */
export default function SosButton({ poolId, details }: { poolId: string; details: string }) {
  const toast = useToast();
  const [state, setState] = useState<"idle" | "starting" | "live">("idle");
  const [token, setToken] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const watch = useRef<number | null>(null);
  const lastSent = useRef(0);

  async function start() {
    // Open the WhatsApp tab now, while we still have the tap. Browsers block pop-ups after awaits.
    const tab = window.open("about:blank", "_blank");
    setState("starting");
    const pos = await currentPosition();
    const res = await fetch("/api/sos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        poolId,
        lat: pos?.coords.latitude,
        lng: pos?.coords.longitude,
        accuracy: pos?.coords.accuracy,
      }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};

    const where = pos
      ? `📍 Right now: https://www.openstreetmap.org/?mlat=${pos.coords.latitude.toFixed(5)}&mlon=${pos.coords.longitude.toFixed(5)}`
      : "📍 Location unavailable. Please call me.";
    const message = [
      "🆘 I need help on my Airpool cab ride.",
      res?.ok ? `🔴 Live location (updates every 20 s): ${body.url}` : null,
      where,
      "",
      details,
    ]
      .filter((l) => l !== null)
      .join("\n");

    if (tab) tab.location.href = whatsappLink(message);
    else window.location.href = whatsappLink(message);

    if (!res?.ok) {
      setState("idle");
      return toast(body.error ?? "Couldn't start live location, but your message is ready in WhatsApp.", "error");
    }
    setToken(body.token);
    setUrl(body.url);
    setState("live");
    lastSent.current = Date.now();
  }

  // Keep the shared location fresh while sharing.
  useEffect(() => {
    if (state !== "live" || !token || !("geolocation" in navigator)) return;
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        if (Date.now() - lastSent.current < UPDATE_EVERY_MS) return;
        lastSent.current = Date.now();
        fetch("/api/sos", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token, lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
        }).catch(() => {});
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 10_000 },
    );
    return () => {
      if (watch.current != null) navigator.geolocation.clearWatch(watch.current);
    };
  }, [state, token]);

  async function stop() {
    if (token) {
      await fetch("/api/sos", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, stop: true }),
      }).catch(() => {});
    }
    setState("idle");
    setToken(null);
    toast("Stopped sharing your location");
  }

  if (state === "live") {
    return (
      <Card className="grid grid-cols-1 gap-3 border-danger/50 bg-danger/10">
        <p className="flex items-center gap-2 font-semibold text-danger">
          <span className="size-2.5 animate-pulse rounded-full bg-danger" /> Sharing your live location
        </p>
        <p className="text-sm text-muted">
          Updates every 20 seconds while this page is open. Anyone with the link can see it for 6 hours.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <a href={whatsappLink(`🔴 My live location on Airpool: ${url}`)} target="_blank" rel="noreferrer" className={buttonClass("ghost")}>
            Send link again
          </a>
          <Button variant="outline" onClick={stop}>
            Stop sharing
          </Button>
        </div>
        <a href="tel:112" className={buttonClass("danger", true)}>
          Call 112
        </a>
      </Card>
    );
  }

  return (
    <Card className="grid grid-cols-1 gap-3 border-danger/30">
      <div>
        <p className="font-semibold">Safety</p>
        <p className="text-sm text-muted">
          SOS sends your live location and the full ride details to anyone you pick on WhatsApp.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={start}
          disabled={state === "starting"}
          className={`${buttonClass("danger")} bg-danger! text-white! hover:brightness-110`}
        >
          {state === "starting" ? <Spinner /> : "🆘 SOS"}
        </button>
        <a href="tel:112" className={buttonClass("outline")}>
          Call 112
        </a>
      </div>
    </Card>
  );
}
