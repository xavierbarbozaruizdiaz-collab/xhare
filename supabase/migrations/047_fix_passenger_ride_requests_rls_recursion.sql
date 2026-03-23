-- Fix 42P17: infinite recursion in policy for relation "passenger_ride_requests"
-- Cause: "Drivers view passenger_ride_requests they offered on" (028) uses
--   EXISTS (SELECT FROM driver_offers ...). Evaluating that applies RLS on driver_offers;
--   "Passenger views driver_offers to own request" (025) uses EXISTS (SELECT FROM passenger_ride_requests ...),
--   which re-evaluates passenger_ride_requests SELECT policies → loop.
-- Fix: cross-table checks via SECURITY DEFINER helpers (bypass RLS inside the function body).

CREATE OR REPLACE FUNCTION public.auth_user_owns_passenger_request(p_request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.passenger_ride_requests prr
    WHERE prr.id = p_request_id
      AND prr.user_id = (SELECT auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.auth_driver_has_offer_on_passenger_request(p_request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.driver_offers o
    WHERE o.passenger_request_id = p_request_id
      AND o.driver_id = (SELECT auth.uid())
  );
$$;

COMMENT ON FUNCTION public.auth_user_owns_passenger_request(uuid) IS
  'RLS helper: avoids recursion between passenger_ride_requests and driver_offers policies.';
COMMENT ON FUNCTION public.auth_driver_has_offer_on_passenger_request(uuid) IS
  'RLS helper: avoids recursion between passenger_ride_requests and driver_offers policies.';

GRANT EXECUTE ON FUNCTION public.auth_user_owns_passenger_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_driver_has_offer_on_passenger_request(uuid) TO authenticated;

DROP POLICY IF EXISTS "Passenger views driver_offers to own request" ON driver_offers;
CREATE POLICY "Passenger views driver_offers to own request"
  ON driver_offers FOR SELECT
  USING (public.auth_user_owns_passenger_request(passenger_request_id));

DROP POLICY IF EXISTS "Passenger can update driver_offers for own request (accept/reject)" ON driver_offers;
CREATE POLICY "Passenger can update driver_offers for own request (accept/reject)"
  ON driver_offers FOR UPDATE
  USING (public.auth_user_owns_passenger_request(passenger_request_id))
  WITH CHECK (true);

DROP POLICY IF EXISTS "Drivers view passenger_ride_requests they offered on" ON passenger_ride_requests;
CREATE POLICY "Drivers view passenger_ride_requests they offered on"
  ON passenger_ride_requests FOR SELECT
  TO authenticated
  USING (public.auth_driver_has_offer_on_passenger_request(id));
