// Shared by the browser forms and the server. The database enforces the same
// phone and UPI patterns with CHECK constraints.

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PHONE_RE = /^[6-9]\d{9}$/;
export const UPI_ID_RE = /^[a-zA-Z0-9._-]{2,255}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/;

/** Keep digits only and drop a leading +91 / 91 / 0. */
export function normalizePhone(raw: string) {
  const d = raw.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) return d.slice(2);
  if (d.length === 11 && d.startsWith("0")) return d.slice(1);
  return d;
}

export function validateEmail(v: string) {
  if (!v.trim()) return "Enter your email.";
  return EMAIL_RE.test(v.trim()) ? null : "Enter a valid email, like you@example.com.";
}

export function validatePassword(v: string) {
  if (v.length < 8) return "Password must be at least 8 characters.";
  if (!/\d/.test(v)) return "Password must include at least one number.";
  return null;
}

export function validateFullName(v: string) {
  const n = v.trim();
  if (n.length < 2) return "Enter your full name.";
  if (n.length > 100) return "Name is too long.";
  return null;
}

export function validatePhone(v: string) {
  const p = normalizePhone(v);
  if (!p) return "Enter your mobile number.";
  return PHONE_RE.test(p) ? null : "Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.";
}

export function validateUpi(v: string) {
  if (!v.trim()) return "Enter your UPI ID.";
  return UPI_ID_RE.test(v.trim()) ? null : "UPI ID should look like name@bank (for example asha@okaxis).";
}

/** Only allow same-site redirect targets after login. */
export function safeNext(raw: string | null) {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";
}

/** IATA flight number: 2-character airline code (letters, or a letter and a digit) + 1–4 digits. */
export const FLIGHT_RE = /^([A-Z]{2}|[A-Z]\d|\d[A-Z])\d{1,4}[A-Z]?$/;

export const normalizeFlight = (v: string) => v.toUpperCase().replace(/[\s-]/g, "");

export function validateFlight(v: string) {
  const f = normalizeFlight(v);
  if (!f) return "Enter your flight number.";
  return FLIGHT_RE.test(f) ? null : "Use the airline code and number, like 6E2134 or AI487.";
}
