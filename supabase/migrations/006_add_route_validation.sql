-- Migration to add route validation and dynamic route updates
-- Adds columns for base route storage and deviation limits

-- Add columns to rides table for route validation
ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS base_route_polyline jsonb,
  ADD COLUMN IF NOT EXISTS max_deviation_km numeric(5,2) DEFAULT 1.0;

-- Add column to ride_stops to mark base stops (origin/destination)
ALTER TABLE ride_stops
  ADD COLUMN IF NOT EXISTS is_base_stop boolean DEFAULT false;

-- Add columns to bookings for passenger pickup/dropoff points
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS pickup_lat double precision,
  ADD COLUMN IF NOT EXISTS pickup_lng double precision,
  ADD COLUMN IF NOT EXISTS pickup_label text,
  ADD COLUMN IF NOT EXISTS dropoff_lat double precision,
  ADD COLUMN IF NOT EXISTS dropoff_lng double precision,
  ADD COLUMN IF NOT EXISTS dropoff_label text;

-- Create index for route queries
CREATE INDEX IF NOT EXISTS idx_rides_base_route ON rides USING gin(base_route_polyline);

-- Create index for stop queries
CREATE INDEX IF NOT EXISTS idx_ride_stops_base ON ride_stops(ride_id, is_base_stop);
