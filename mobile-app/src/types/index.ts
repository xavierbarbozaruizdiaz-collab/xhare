/**
 * Shared types aligned with backend (Supabase / Next API).
 * Source of truth: repo root src/types/index.ts
 */

export type UserRole = 'passenger' | 'driver' | 'admin';

export type RequestMode = 'route_fixed' | 'free' | 'unknown';

export type RequestStatus =
  | 'draft'
  | 'submitted'
  | 'proposed'
  | 'confirmed'
  | 'assigned'
  | 'en_route'
  | 'boarded'
  | 'completed'
  | 'cancelled'
  | 'expired';

export type RideStatus =
  | 'draft'
  | 'published'
  | 'booked'
  | 'en_route'
  | 'completed'
  | 'cancelled';

export type PassengerStatus =
  | 'pending'
  | 'checked_in'
  | 'no_show'
  | 'cancelled';

export type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'cancelled'
  | 'completed';

export interface Profile {
  id: string;
  role: UserRole;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  bio: string | null;
  rating_average: number;
  rating_count: number;
  verified: boolean;
  vehicle_photo_url: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  available: boolean;
  created_at: string;
}

export interface Ride {
  id: string;
  mode: 'route_fixed' | 'free';
  route_id: string | null;
  driver_id: string | null;
  capacity: number;
  status: RideStatus;
  departure_time: string | null;
  origin_lat: number | null;
  origin_lng: number | null;
  origin_label: string | null;
  destination_lat: number | null;
  destination_lng: number | null;
  destination_label: string | null;
  price_per_seat: number;
  available_seats: number;
  description: string | null;
  vehicle_info: unknown;
  flexible_departure: boolean;
  flexible_return: boolean;
  return_departure_time: string | null;
  return_price_per_seat: number | null;
  created_at: string;
}

export interface RideStop {
  id: string;
  ride_id: string;
  stop_order: number;
  lat: number;
  lng: number;
  label: string | null;
  eta: string | null;
  created_at: string;
}

export interface Booking {
  id: string;
  ride_id: string;
  passenger_id: string;
  seats_count: number;
  pickup_stop_id: string | null;
  dropoff_stop_id: string | null;
  status: BookingStatus;
  price_paid: number;
  payment_status: 'pending' | 'paid' | 'refunded';
  cancellation_reason: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Point {
  lat: number;
  lng: number;
}
