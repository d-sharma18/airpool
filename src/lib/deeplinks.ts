import type { Point } from "./osrm";

interface Place extends Point {
  name: string;
}

/** Uber universal link. Opens the app if installed, otherwise m.uber.com. Extra stops are added in-app. */
export function uberLink(pickup: Place, dropoff: Place) {
  const p = new URLSearchParams({
    action: "setPickup",
    "pickup[latitude]": String(pickup.lat),
    "pickup[longitude]": String(pickup.lng),
    "pickup[nickname]": pickup.name,
    "dropoff[latitude]": String(dropoff.lat),
    "dropoff[longitude]": String(dropoff.lng),
    "dropoff[nickname]": dropoff.name,
  });
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

/** Standard UPI intent; opens GPay / PhonePe / Paytm / BHIM with amount pre-filled. */
export function upiLink(vpa: string, payeeName: string, amount: number, note: string) {
  const p = new URLSearchParams({
    pa: vpa,
    pn: payeeName,
    am: amount.toFixed(2),
    cu: "INR",
    tn: note.slice(0, 50),
  });
  return `upi://pay?${p}`;
}

export const UPI_ID_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/;
