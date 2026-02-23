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
  | 'building' 
  | 'ready' 
  | 'assigned' 
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

export interface Route {
  id: string;
  name: string;
  direction: string | null;
  polyline: Array<{ lat: number; lng: number }>;
  active: boolean;
  created_at: string;
}

export interface RideRequest {
  id: string;
  passenger_id: string;
  pickup_lat: number;
  pickup_lng: number;
  pickup_label: string | null;
  dropoff_lat: number;
  dropoff_lng: number;
  dropoff_label: string | null;
  pax_count: number;
  window_start: string;
  window_end: string;
  mode: RequestMode;
  status: RequestStatus;
  proposed_meeting_lat: number | null;
  proposed_meeting_lng: number | null;
  proposed_meeting_label: string | null;
  price_estimate: number | null;
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
  // BlaBlaCar fields
  origin_lat: number | null;
  origin_lng: number | null;
  origin_label: string | null;
  destination_lat: number | null;
  destination_lng: number | null;
  destination_label: string | null;
  price_per_seat: number;
  available_seats: number;
  description: string | null;
  vehicle_info: any;
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

export interface RidePassenger {
  id: string;
  ride_id: string;
  request_id: string;
  passenger_id: string;
  status: PassengerStatus;
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

export interface Review {
  id: string;
  ride_id: string;
  booking_id: string | null;
  reviewer_id: string;
  reviewed_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

export interface Message {
  id: string;
  ride_id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  read: boolean;
  created_at: string;
}

export interface Settings {
  capacity: number;
  time_window_minutes: number;
  route_corridor_m: number;
  max_walk_meters: number;
  max_detour_minutes: number;
  pickup_cluster_radius_m: number;
  mode_enabled_route_fixed: boolean;
  mode_enabled_free: boolean;
}

export interface Point {
  lat: number;
  lng: number;
}
