export type Gender = "M" | "F" | "T";
export type PoolStatus = "open" | "locked" | "completed" | "cancelled";

export interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  gender: Gender | null;
  birth_year: number | null;
  aadhaar_verified: boolean;
  aadhaar_signature_ok: boolean;
  face_match_score: number | null;
  verified_at: string | null;
  avatar_path: string | null;
  upi_id: string | null;
}

export interface Pool {
  id: string;
  created_by: string;
  airport_iata: string;
  zone: string;
  women_only: boolean;
  max_pax: number;
  status: PoolStatus;
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
  joined_at: string;
}

export interface PoolMatch {
  pool_id: string;
  creator_first_name: string;
  member_count: number;
  pax_used: number;
  max_pax: number;
  women_only: boolean;
  earliest: string;
  latest: string;
  same_flight: boolean;
  nearest_km: number;
}

export type VehicleClass = "mini" | "sedan" | "suv" | "xl";

export interface VehicleRecommendation {
  vehicle: VehicleClass;
  label: string;
  uber: string;
  ola: string;
  seats: number;
  reason: string;
  source: "gemini" | "groq" | "rules";
}

export interface FareShare {
  user_id: string;
  km: number;
  amount: number;
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
  shares: FareShare[];
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
