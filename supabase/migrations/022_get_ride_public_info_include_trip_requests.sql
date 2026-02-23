-- Incluir en get_ride_public_info los puntos de recogida/descenso de las solicitudes
-- aceptadas (trip_requests con ride_id y status = 'accepted') para que aparezcan en el mapa
-- al ver el viaje, sin depender de RLS en trip_requests.

CREATE OR REPLACE FUNCTION get_ride_public_info(p_ride_id uuid)
RETURNS TABLE(
  booked_seats bigint,
  pickups jsonb,
  dropoffs jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_booked_seats bigint;
  v_pickups jsonb;
  v_dropoffs jsonb;
  v_trip_pickups jsonb;
  v_trip_dropoffs jsonb;
BEGIN
  SELECT COALESCE(SUM(b.seats_count), 0)::bigint INTO v_booked_seats
  FROM bookings b WHERE b.ride_id = p_ride_id AND b.status != 'cancelled';

  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('lat', b.pickup_lat, 'lng', b.pickup_lng, 'label', b.pickup_label)),
    '[]'::jsonb
  ) INTO v_pickups
  FROM bookings b
  WHERE b.ride_id = p_ride_id AND b.status != 'cancelled' AND b.pickup_lat IS NOT NULL AND b.pickup_lng IS NOT NULL;

  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('lat', b.dropoff_lat, 'lng', b.dropoff_lng, 'label', b.dropoff_label)),
    '[]'::jsonb
  ) INTO v_dropoffs
  FROM bookings b
  WHERE b.ride_id = p_ride_id AND b.status != 'cancelled' AND b.dropoff_lat IS NOT NULL AND b.dropoff_lng IS NOT NULL;

  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('lat', tr.origin_lat, 'lng', tr.origin_lng, 'label', tr.origin_label)),
    '[]'::jsonb
  ) INTO v_trip_pickups
  FROM trip_requests tr
  WHERE tr.ride_id = p_ride_id AND tr.status = 'accepted' AND tr.origin_lat IS NOT NULL AND tr.origin_lng IS NOT NULL;

  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('lat', tr.destination_lat, 'lng', tr.destination_lng, 'label', tr.destination_label)),
    '[]'::jsonb
  ) INTO v_trip_dropoffs
  FROM trip_requests tr
  WHERE tr.ride_id = p_ride_id AND tr.status = 'accepted' AND tr.destination_lat IS NOT NULL AND tr.destination_lng IS NOT NULL;

  RETURN QUERY SELECT
    v_booked_seats,
    COALESCE(v_pickups, '[]'::jsonb) || COALESCE(v_trip_pickups, '[]'::jsonb),
    COALESCE(v_dropoffs, '[]'::jsonb) || COALESCE(v_trip_dropoffs, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION get_ride_public_info(uuid) IS 'Detalle del viaje: asientos reservados y puntos recogida/descenso (bookings + solicitudes aceptadas).';
GRANT EXECUTE ON FUNCTION get_ride_public_info(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_ride_public_info(uuid) TO anon;
