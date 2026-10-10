"use client";

import { useEffect, useState } from "react";
import { useToast } from "./toaster";

/** Thin banner while the device is offline, plus a toast when the connection comes back. */
export default function OfflineBanner() {
  const toast = useToast();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    setOffline(!navigator.onLine);
    const down = () => setOffline(true);
    const up = () => {
      setOffline(false);
      toast("Back online", "success");
    };
    window.addEventListener("offline", down);
    window.addEventListener("online", up);
    return () => {
      window.removeEventListener("offline", down);
      window.removeEventListener("online", up);
    };
  }, [toast]);

  if (!offline) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-[2100] bg-danger px-4 pb-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] text-center text-sm font-medium text-white animate-[toast-in_180ms_ease-out]"
    >
      You&apos;re offline. Changes will fail until you reconnect.
    </div>
  );
}
