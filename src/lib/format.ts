const TZ = "Asia/Kolkata";

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { timeZone: TZ, hour: "numeric", minute: "2-digit" });

export const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });

export const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export const firstName = (name?: string | null) => (name ?? "Rider").split(" ")[0];
