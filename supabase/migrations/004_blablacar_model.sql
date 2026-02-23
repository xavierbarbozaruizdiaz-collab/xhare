-- Migration to transform to BlaBlaCar-like model
-- This migration updates the rides table and creates new tables for bookings, reviews, and messages

-- 1. Update rides table to match BlaBlaCar model
ALTER TABLE rides 
  ADD COLUMN IF NOT EXISTS origin_lat double precision,
  ADD COLUMN IF NOT EXISTS origin_lng double precision,
  ADD COLUMN IF NOT EXISTS origin_label text,
  ADD COLUMN IF NOT EXISTS destination_lat double precision,
  ADD COLUMN IF NOT EXISTS destination_lng double precision,
  ADD COLUMN IF NOT EXISTS destination_label text,
  ADD COLUMN IF NOT EXISTS price_per_seat numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS available_seats int DEFAULT 15,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS vehicle_info jsonb,
  ADD COLUMN IF NOT EXISTS flexible_departure boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS flexible_return boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS return_departure_time timestamptz,
  ADD COLUMN IF NOT EXISTS return_price_per_seat numeric(10,2);

-- Make departure_time NOT NULL for published rides
-- ALTER TABLE rides ALTER COLUMN departure_time SET NOT NULL; -- Commented to avoid breaking existing data

-- Update status enum to include 'published' and 'booked'
ALTER TABLE rides DROP CONSTRAINT IF EXISTS rides_status_check;
ALTER TABLE rides ADD CONSTRAINT rides_status_check 
  CHECK (status IN ('draft', 'published', 'booked', 'en_route', 'completed', 'cancelled'));

-- 2. Create bookings table (replaces ride_passengers for BlaBlaCar model)
CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  passenger_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  seats_count int NOT NULL CHECK (seats_count > 0 AND seats_count <= 8),
  pickup_stop_id uuid REFERENCES ride_stops(id),
  dropoff_stop_id uuid REFERENCES ride_stops(id),
  status text CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')) DEFAULT 'pending',
  price_paid numeric(10,2) NOT NULL,
  payment_status text CHECK (payment_status IN ('pending', 'paid', 'refunded')) DEFAULT 'pending',
  cancellation_reason text,
  cancelled_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(ride_id, passenger_id) -- One booking per passenger per ride
);

-- 3. Create reviews table
CREATE TABLE IF NOT EXISTS reviews (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  reviewer_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reviewed_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rating int NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(ride_id, reviewer_id, reviewed_id) -- One review per user per ride
);

-- 4. Create messages table
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  receiver_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content text NOT NULL,
  read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- 5. Add profile enhancements
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS rating_average numeric(3,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS vehicle_photo_url text,
  ADD COLUMN IF NOT EXISTS vehicle_model text,
  ADD COLUMN IF NOT EXISTS vehicle_year int;

-- 6. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_rides_origin ON rides(origin_lat, origin_lng);
CREATE INDEX IF NOT EXISTS idx_rides_destination ON rides(destination_lat, destination_lng);
CREATE INDEX IF NOT EXISTS idx_rides_departure_time ON rides(departure_time);
CREATE INDEX IF NOT EXISTS idx_rides_status_published ON rides(status) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_rides_driver_status ON rides(driver_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_ride ON bookings(ride_id);
CREATE INDEX IF NOT EXISTS idx_bookings_passenger ON bookings(passenger_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewed ON reviews(reviewed_id);
CREATE INDEX IF NOT EXISTS idx_reviews_ride ON reviews(ride_id);
CREATE INDEX IF NOT EXISTS idx_messages_ride ON messages(ride_id);
CREATE INDEX IF NOT EXISTS idx_messages_participants ON messages(sender_id, receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(receiver_id, read) WHERE read = false;

-- 7. Enable RLS on new tables
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- 8. RLS Policies for bookings
CREATE POLICY "Passengers can view their own bookings"
  ON bookings FOR SELECT
  USING (passenger_id = auth.uid());

CREATE POLICY "Drivers can view bookings for their rides"
  ON bookings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM rides
      WHERE rides.id = bookings.ride_id
      AND rides.driver_id = auth.uid()
    )
  );

CREATE POLICY "Passengers can create bookings"
  ON bookings FOR INSERT
  WITH CHECK (passenger_id = auth.uid());

CREATE POLICY "Drivers can update bookings for their rides"
  ON bookings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM rides
      WHERE rides.id = bookings.ride_id
      AND rides.driver_id = auth.uid()
    )
  );

CREATE POLICY "Passengers can cancel their own bookings"
  ON bookings FOR UPDATE
  USING (passenger_id = auth.uid())
  WITH CHECK (passenger_id = auth.uid());

-- 9. RLS Policies for reviews
CREATE POLICY "Anyone can view reviews"
  ON reviews FOR SELECT
  USING (true);

CREATE POLICY "Users can create reviews for their bookings"
  ON reviews FOR INSERT
  WITH CHECK (
    reviewer_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM bookings
      WHERE bookings.id = reviews.booking_id
      AND bookings.passenger_id = auth.uid()
      AND bookings.status = 'completed'
    )
  );

-- 10. RLS Policies for messages
CREATE POLICY "Users can view messages they sent or received"
  ON messages FOR SELECT
  USING (sender_id = auth.uid() OR receiver_id = auth.uid());

CREATE POLICY "Users can send messages"
  ON messages FOR INSERT
  WITH CHECK (sender_id = auth.uid());

CREATE POLICY "Users can mark their received messages as read"
  ON messages FOR UPDATE
  USING (receiver_id = auth.uid())
  WITH CHECK (receiver_id = auth.uid());

-- 11. Function to update available_seats when booking is created/updated
CREATE OR REPLACE FUNCTION update_ride_available_seats()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE rides
    SET available_seats = available_seats - NEW.seats_count
    WHERE id = NEW.ride_id;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- If booking is cancelled, return seats
    IF OLD.status != 'cancelled' AND NEW.status = 'cancelled' THEN
      UPDATE rides
      SET available_seats = available_seats + OLD.seats_count
      WHERE id = NEW.ride_id;
    -- If seats count changes
    ELSIF OLD.seats_count != NEW.seats_count THEN
      UPDATE rides
      SET available_seats = available_seats + OLD.seats_count - NEW.seats_count
      WHERE id = NEW.ride_id;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updating available seats
DROP TRIGGER IF EXISTS trigger_update_available_seats ON bookings;
CREATE TRIGGER trigger_update_available_seats
  AFTER INSERT OR UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION update_ride_available_seats();

-- 12. Function to update profile rating when review is created
CREATE OR REPLACE FUNCTION update_profile_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE profiles
  SET 
    rating_average = (
      SELECT COALESCE(AVG(rating), 0)
      FROM reviews
      WHERE reviewed_id = NEW.reviewed_id
    ),
    rating_count = (
      SELECT COUNT(*)
      FROM reviews
      WHERE reviewed_id = NEW.reviewed_id
    )
  WHERE id = NEW.reviewed_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updating profile ratings
DROP TRIGGER IF EXISTS trigger_update_profile_rating ON reviews;
CREATE TRIGGER trigger_update_profile_rating
  AFTER INSERT ON reviews
  FOR EACH ROW
  EXECUTE FUNCTION update_profile_rating();
