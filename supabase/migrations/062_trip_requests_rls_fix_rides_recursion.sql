-- Fix 42P17: infinite recursion in policy for relation "trip_requests"
-- Cause: policy "Anyone can view accepted trip_requests for published rides" (061) uses
--   EXISTS (SELECT FROM rides r WHERE ...). That applies RLS on rides; policy "Anyone can view published rides" (060)
--   for status = awaiting_driver includes EXISTS (SELECT FROM trip_requests ...), which re-applies trip_requests
--   SELECT policies → loop.
-- Fix: read ride status in a SECURITY DEFINER helper so rides RLS is not evaluated from this policy branch.

CREATE OR REPLACE FUNCTION public.trip_request_linked_ride_is_published_or_awaiting(p_ride_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.rides r
    WHERE r.id = p_ride_id
      AND r.status IN ('published', 'awaiting_driver')
  );
$$;

COMMENT ON FUNCTION public.trip_request_linked_ride_is_published_or_awaiting(uuid) IS
  'RLS helper: true si el ride vinculado está publicado o en awaiting_driver. Evita recursión rides↔trip_requests.';

REVOKE ALL ON FUNCTION public.trip_request_linked_ride_is_published_or_awaiting(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trip_request_linked_ride_is_published_or_awaiting(uuid) TO authenticated;

DROP POLICY IF EXISTS "Anyone can view accepted trip_requests for published rides" ON public.trip_requests;
CREATE POLICY "Anyone can view accepted trip_requests for published rides"
  ON public.trip_requests FOR SELECT
  USING (
    status = 'accepted'
    AND ride_id IS NOT NULL
    AND public.trip_request_linked_ride_is_published_or_awaiting(ride_id)
  );

COMMENT ON POLICY "Anyone can view accepted trip_requests for published rides" ON public.trip_requests IS
  'Ver solicitudes aceptadas de un viaje publicado o en awaiting_driver (mapa y cupo despacho); sin recursión RLS.';
