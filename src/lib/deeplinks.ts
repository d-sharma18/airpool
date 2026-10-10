import type { Point } from "./osrm";

interface Place extends Point {
  name: string;
}

/**
 * Uber's official universal deep link (developer.uber.com "Ride Requests: deep links").
 * Opens the Uber app with pickup and drop-off filled in, or m.uber.com if it isn't installed.
 * The rider still confirms and books in Uber; nothing is booked automatically.
 */
export function uberLink(pickup: Place, dropoff: Place & { address?: string }) {
  const p = new URLSearchParams({
    action: "setPickup",
    "pickup[latitude]": String(pickup.lat),
    "pickup[longitude]": String(pickup.lng),
    "pickup[nickname]": pickup.name,
    "dropoff[latitude]": String(dropoff.lat),
    "dropoff[longitude]": String(dropoff.lng),
    "dropoff[nickname]": dropoff.name,
  });
  if (dropoff.address) p.set("dropoff[formatted_address]", dropoff.address);
  return `https://m.uber.com/ul/?${p}`;
}

/** Ola web booking link (hands off to the Ola app on mobile). */
export function olaLink(pickup: Place, dropoff: Place) {
  const p = new URLSearchParams({
    serviceType: "p2p",
    utm_source: "airpool",
    lat: String(pickup.lat),
    lng: String(pickup.lng),
    pickup_name: pickup.name,
    drop_lat: String(dropoff.lat),
    drop_lng: String(dropoff.lng),
    drop_name: dropoff.name,
  });
  return `https://book.olacabs.com/?${p}`;
}

function upiParams(vpa: string, payeeName: string, amount: number, note: string) {
  return new URLSearchParams({
    pa: vpa,
    pn: payeeName.slice(0, 50),
    am: amount.toFixed(2),
    cu: "INR",
    tn: note.slice(0, 50),
  });
}

/**
 * Standard UPI intent (NPCI "upi://pay"). On Android it opens the app picker
 * (GPay, PhonePe, Paytm, BHIM…) with the payee and exact amount filled in. No gateway in between.
 */
export function upiLink(vpa: string, payeeName: string, amount: number, note: string) {
  return `upi://pay?${upiParams(vpa, payeeName, amount, note)}`;
}

/** iPhones don't route "upi://", so offer each app's own scheme too. */
export function upiAppLinks(vpa: string, payeeName: string, amount: number, note: string) {
  const q = upiParams(vpa, payeeName, amount, note).toString();
  return [
    { app: "GPay", href: `gpay://upi/pay?${q}` },
    { app: "PhonePe", href: `phonepe://pay?${q}` },
    { app: "Paytm", href: `paytmmp://pay?${q}` },
  ];
}
