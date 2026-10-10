"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { cx } from "./ui";

type Tone = "default" | "success" | "error";
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => {});

/** `const toast = useToast(); toast("Saved", "success")` */
export const useToast = () => useContext(ToastContext);

export function Toaster({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, tone: Tone = "default") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-[2000] mx-auto grid max-w-md gap-2 px-4"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cx(
              "pointer-events-auto flex items-center gap-2 rounded-xl border bg-surface-2 px-4 py-3 text-sm shadow-2xl shadow-black/60 animate-[toast-in_180ms_ease-out]",
              t.tone === "success" && "border-ok/40",
              t.tone === "error" && "border-danger/40",
              t.tone === "default" && "border-line",
            )}
          >
            <span
              className={cx(
                "size-2 shrink-0 rounded-full",
                t.tone === "success" ? "bg-ok" : t.tone === "error" ? "bg-danger" : "bg-accent",
              )}
            />
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
