-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Helper functions for RLS
CREATE OR REPLACE FUNCTION is_admin(user_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles
    WHERE id = user_id AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_driver(user_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles
    WHERE id = user_id AND role = 'driver'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 1. Profiles table
CREATE TABLE profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('passenger', 'driver', 'admin')),
  full_name text,
  phone text,
  created_at timestamptz DEFAULT now()
);

-- 2. Routes table (for Ruta Fija)
CREATE TABLE routes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  direction text,
  polyline jsonb NOT NULL, -- Array of {lat, lng} points
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- 3. Settings table
CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- Insert default settings
INSERT INTO settings (key, value) VALUES
  ('capacity', '15'),
  ('time_window_minutes', '20'),
  ('route_corridor_m', '800'),
  ('max_walk_meters', '600'),
  ('max_detour_minutes', '10'),
  ('pickup_cluster_radius_m', '500'),
  ('mode_enabled_route_fixed', 'true'),
  ('mode_enabled_free', 'false');

-- 4. Ride Requests table
CREATE TABLE ride_requests (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  passenger_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  pickup_lat double precision NOT NULL,
  pickup_lng double precision NOT NULL,
  pickup_label text,
  dropoff_lat double precision NOT NULL,
  dropoff_lng double precision NOT NULL,
  dropoff_label text,
  pax_count int NOT NULL CHECK (pax_count BETWEEN 1 AND 4),
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  mode text CHECK (mode IN ('route_fixed', 'free', 'unknown')) DEFAULT 'unknown',
  status text CHECK (status IN ('draft', 'submitted', 'proposed', 'confirmed', 'assigned', 'en_route', 'boarded', 'completed', 'cancelled', 'expired')) DEFAULT 'submitted',
  proposed_meeting_lat double precision,
  proposed_meeting_lng double precision,
  proposed_meeting_label text,
  price_estimate int,
  created_at timestamptz DEFAULT now()
);

-- 5. Rides table
CREATE TABLE rides (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  mode text NOT NULL CHECK (mode IN ('route_fixed', 'free')),
  route_id uuid REFERENCES routes(id),
  driver_id uuid REFERENCES profiles(id),
  capacity int DEFAULT 15,
  status text CHECK (status IN ('building', 'ready', 'assigned', 'en_route', 'completed', 'cancelled')) DEFAULT 'building',
  departure_time timestamptz,
  created_at timestamptz DEFAULT now()
);

-- 6. Ride Stops table
CREATE TABLE ride_stops (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  stop_order int NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  label text,
  eta timestamptz,
  created_at timestamptz DEFAULT now()
);

-- 7. Ride Passengers table
CREATE TABLE ride_passengers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES ride_requests(id) ON DELETE CASCADE,
  passenger_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status text CHECK (status IN ('pending', 'checked_in', 'no_show', 'cancelled')) DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  UNIQUE(ride_id, request_id)
);

-- 8. Audit Events table
CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id uuid REFERENCES profiles(id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb,
  created_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX idx_ride_requests_passenger ON ride_requests(passenger_id);
CREATE INDEX idx_ride_requests_status ON ride_requests(status);
CREATE INDEX idx_ride_requests_mode ON ride_requests(mode);
CREATE INDEX idx_rides_driver ON rides(driver_id);
CREATE INDEX idx_rides_status ON rides(status);
CREATE INDEX idx_rides_departure_time ON rides(departure_time);
CREATE INDEX idx_ride_stops_ride ON ride_stops(ride_id);
CREATE INDEX idx_ride_passengers_ride ON ride_passengers(ride_id);
CREATE INDEX idx_ride_passengers_passenger ON ride_passengers(passenger_id);
CREATE INDEX idx_audit_events_entity ON audit_events(entity_type, entity_id);

-- RLS Policies

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ride_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE ride_stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE ride_passengers ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view their own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles"
  ON profiles FOR SELECT
  USING (is_admin(auth.uid()));

-- Routes policies
CREATE POLICY "Everyone can view active routes"
  ON routes FOR SELECT
  USING (active = true);

CREATE POLICY "Admins can manage routes"
  ON routes FOR ALL
  USING (is_admin(auth.uid()));

-- Settings policies
CREATE POLICY "Admins can view settings"
  ON settings FOR SELECT
  USING (is_admin(auth.uid()));

CREATE POLICY "Admins can update settings"
  ON settings FOR UPDATE
  USING (is_admin(auth.uid()));

-- Ride Requests policies
CREATE POLICY "Passengers can view their own requests"
  ON ride_requests FOR SELECT
  USING (passenger_id = auth.uid());

CREATE POLICY "Passengers can create their own requests"
  ON ride_requests FOR INSERT
  WITH CHECK (passenger_id = auth.uid());

CREATE POLICY "Passengers can update their own requests"
  ON ride_requests FOR UPDATE
  USING (passenger_id = auth.uid());

CREATE POLICY "Admins can view all requests"
  ON ride_requests FOR SELECT
  USING (is_admin(auth.uid()));

CREATE POLICY "Admins can update all requests"
  ON ride_requests FOR UPDATE
  USING (is_admin(auth.uid()));

-- Rides policies
CREATE POLICY "Drivers can view their assigned rides"
  ON rides FOR SELECT
  USING (driver_id = auth.uid() OR is_admin(auth.uid()));

CREATE POLICY "Admins can manage all rides"
  ON rides FOR ALL
  USING (is_admin(auth.uid()));

-- Ride Stops policies
CREATE POLICY "Drivers can view stops for their rides"
  ON ride_stops FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM rides
      WHERE rides.id = ride_stops.ride_id
      AND (rides.driver_id = auth.uid() OR is_admin(auth.uid()))
    )
  );

CREATE POLICY "Admins can manage all stops"
  ON ride_stops FOR ALL
  USING (is_admin(auth.uid()));

-- Ride Passengers policies
CREATE POLICY "Passengers can view their own ride passengers"
  ON ride_passengers FOR SELECT
  USING (passenger_id = auth.uid());

CREATE POLICY "Drivers can view passengers in their rides"
  ON ride_passengers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM rides
      WHERE rides.id = ride_passengers.ride_id
      AND rides.driver_id = auth.uid()
    )
  );

CREATE POLICY "Admins can view all ride passengers"
  ON ride_passengers FOR SELECT
  USING (is_admin(auth.uid()));

CREATE POLICY "Admins can manage ride passengers"
  ON ride_passengers FOR ALL
  USING (is_admin(auth.uid()));

-- Audit Events policies
CREATE POLICY "Admins can view all audit events"
  ON audit_events FOR SELECT
  USING (is_admin(auth.uid()));

CREATE POLICY "System can insert audit events"
  ON audit_events FOR INSERT
  WITH CHECK (true);

