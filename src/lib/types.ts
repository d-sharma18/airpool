export type Gender = "M" | "F" | "T";
export type PoolStatus = "open" | "locked" | "completed" | "cancelled";
export type MeetingPoint = "arrival_gate" | "pickup_zone" | "parking" | "other";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  upi_id: string | null;
  verified: boolean;
  verified_name: string | null;
  verified_gender: Gender | null;
  aadhaar_last4: string | null;
  verified_at: string | null;
  phone_verified: boolean;
  birth_year: number | null;
  aadhaar_signature_ok: boolean;
  face_match_score: number | null;
  avatar_path: string | null;
  women_only_blocked: boolean;
  flagged_at: string | null;
  blocked: boolean;
  is_demo: boolean;
}

export interface Pool {
  id: string;
  created_by: string;
  airport_iata: string;
  zone: string;
  women_only: boolean;
  max_pax: number;
  status: PoolStatus;
  women_wait_until: string | null;
  meeting_point: MeetingPoint | null;
  meeting_note: string | null;
  booker_id: string | null;
  driver_name: string | null;
  car_number: string | null;
  car_model: string | null;
  booked_at: string | null;
  plan: PoolPlan | null;
  created_at: string;
}

export interface PoolMember {
  pool_id: string;
  user_id: string;
  flight_iata: string | null;
  arrival_at: string;
  dest_label: string;
  dest_lat: number;
  dest_lng: number;
  dest_zone: string;
  pax: number;
  cabin_bags: number;
  checked_bags: number;
  paid: boolean;
  accepted: boolean;
  paid_claimed_at: string | null;
  joined_at: string;
}

export type VehicleClass = "mini" | "sedan" | "suv";

export interface VehicleRecommendation {
  vehicle: VehicleClass;
  label: string;
  uber: string;
  ola: string;
  seats: number;
  /** One line, e.g. "4 people with 4 big bags won't fit in a sedan boot. Take an SUV." */
  reason: string;
  /** 0–1. The rules answer is 1 when everything fits. */
  confidence: number;
  source: "gemini" | "groq" | "rules";
  load: { pax: number; checked: number; cabin: number; bagUnits: number };
  /** Set when the AI's pick was rejected by the rules. */
  overridden?: { aiPick: VehicleClass; source: "gemini" | "groq"; why: "too_small" | "too_big" };
}

export interface FareShare {
  user_id: string;
  /** Road distance from the airport to this rider's drop. */
  km: number;
  amount: number;
  /** What the simple formula gives, rounded. */
  formula: number;
  reason: string;
}

export interface PoolPlan {
  signature: string;
  computed_at: string;
  vehicle: VehicleRecommendation;
  /** Member ids in drop order. */
  drop_order: string[];
  total_km: number;
  total_min: number;
  /** [lat, lng] pairs for the map. */
  geometry: [number, number][];
  fare_total: number;
  fare_source: "gemini" | "groq" | "rules" | "actual";
  fare_note: string;
  /** One per rider, in drop order. */
  shares: FareShare[];
  /** "ai" only when the AI split passed both server checks. */
  split_method: "ai" | "formula";
  split_source?: "gemini";
  /** Why the formula was used instead of AI, if it was. */
  split_note?: string;
  /** True once the booker has entered the real fare. */
  final: boolean;
  route_source?: "osrm-trip" | "osrm-route" | "straight-line";
}

export interface FlightInfo {
  flight_iata: string;
  airline: string | null;
  departure_iata: string | null;
  arrival_iata: string | null;
  arrival_airport: string | null;
  terminal: string | null;
  /** Local airport time, ISO with +05:30 offset. */
  scheduled_arrival: string | null;
  estimated_arrival: string | null;
  status: string | null;
}

export type PreferredCar = "any" | "mini" | "sedan" | "suv";
export type TripStatus = "searching" | "matched" | "cancelled" | "completed";

export interface TripRequest {
  id: string;
  user_id: string;
  flight_iata: string;
  arrival_date: string;
  arrival_at: string;
  arrival_source: "aviationstack" | "manual";
  airport_iata: string;
  dest_label: string;
  dest_lat: number;
  dest_lng: number;
  zone: string;
  pax: number;
  checked_bags: number;
  cabin_bags: number;
  preferred_car: PreferredCar;
  women_only: boolean;
  notify_on_match: boolean;
  status: TripStatus;
  pool_id: string | null;
  created_at: string;
}
