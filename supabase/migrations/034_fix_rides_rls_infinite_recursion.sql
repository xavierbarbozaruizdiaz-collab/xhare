-- Fix 42P17: infinite recursion in policy for relation 'rides'
-- Cause: "Anyone can view published rides" (from 032) used EXISTS(SELECT FROM bookings WHERE ride_id = rides.id).
-- Evaluating that subquery applies RLS on bookings; "Drivers can view bookings for their rides" does SELECT FROM rides,
-- which re-evaluates rides SELECT policy → infinite loop.
-- Fix: Rides policies must not reference rides nor any table whose RLS in turn reads rides.

DROP POLICY IF EXISTS "Anyone can view published rides" ON rides;
DROP POLICY IF EXISTS "Drivers can create rides" ON rides;
DROP POLICY IF EXISTS "Drivers can update their own rides" ON rides;
DROP POLICY IF EXISTS "Drivers can delete their own rides" ON rides;
DROP POLICY IF EXISTS "Admins can manage all rides" ON rides;

-- SELECT: only column-based conditions (no subquery to bookings/rides)
CREATE POLICY "Anyone can view published rides"
  ON rides FOR SELECT
  USING (status = 'published' OR driver_id = auth.uid() OR is_admin(auth.uid()));

-- INSERT
CREATE POLICY "Drivers can create rides"
  ON rides FOR INSERT
  WITH CHECK (driver_id = auth.uid());

-- UPDATE
CREATE POLICY "Drivers can update their own rides"
  ON rides FOR UPDATE
  USING (driver_id = auth.uid())
  WITH CHECK (driver_id = auth.uid());

-- DELETE
CREATE POLICY "Drivers can delete their own rides"
  ON rides FOR DELETE
  USING (driver_id = auth.uid());

-- Admins (is_admin reads profiles only, no rides)
CREATE POLICY "Admins can manage all rides"
  ON rides FOR ALL
  USING (is_admin(auth.uid()));
