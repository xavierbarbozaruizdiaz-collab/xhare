-- Migration to fix RLS policies for rides and add missing validations
-- This ensures drivers can create/update rides and everyone can view published rides

-- 1. Drop existing restrictive policies for rides (if they exist)
DROP POLICY IF EXISTS "Drivers can view their assigned rides" ON rides;
DROP POLICY IF EXISTS "Admins can manage all rides" ON rides;

-- 2. Create new comprehensive RLS policies for rides (idempotent: drop before create)

DROP POLICY IF EXISTS "Anyone can view published rides" ON rides;
CREATE POLICY "Anyone can view published rides"
  ON rides FOR SELECT
  USING (status = 'published' OR driver_id = auth.uid() OR is_admin(auth.uid()));

DROP POLICY IF EXISTS "Drivers can create rides" ON rides;
CREATE POLICY "Drivers can create rides"
  ON rides FOR INSERT
  WITH CHECK (
    driver_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'driver'
    )
  );

DROP POLICY IF EXISTS "Drivers can update their own rides" ON rides;
CREATE POLICY "Drivers can update their own rides"
  ON rides FOR UPDATE
  USING (driver_id = auth.uid())
  WITH CHECK (driver_id = auth.uid());

DROP POLICY IF EXISTS "Drivers can delete their own rides" ON rides;
CREATE POLICY "Drivers can delete their own rides"
  ON rides FOR DELETE
  USING (driver_id = auth.uid());

DROP POLICY IF EXISTS "Admins can manage all rides" ON rides;
CREATE POLICY "Admins can manage all rides"
  ON rides FOR ALL
  USING (is_admin(auth.uid()));

-- 3. Add function to validate driver role
CREATE OR REPLACE FUNCTION is_driver(user_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles
    WHERE id = user_id AND role = 'driver'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Add function to validate passenger role
CREATE OR REPLACE FUNCTION is_passenger(user_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles
    WHERE id = user_id AND role = 'passenger'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Add constraint to ensure available_seats doesn't go negative (idempotent)
ALTER TABLE rides DROP CONSTRAINT IF EXISTS check_available_seats_non_negative;
ALTER TABLE rides 
  ADD CONSTRAINT check_available_seats_non_negative 
  CHECK (available_seats >= 0);

-- 6. Add constraint to ensure departure_time is in the future for published rides
-- Note: This is a soft constraint - we'll validate in application code
-- Hard constraint would prevent editing old rides

-- 7. Add index for faster search queries
CREATE INDEX IF NOT EXISTS idx_rides_search 
  ON rides(status, departure_time, available_seats) 
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_rides_origin_destination 
  ON rides USING GIN (to_tsvector('spanish', COALESCE(origin_label, '') || ' ' || COALESCE(destination_label, '')));
