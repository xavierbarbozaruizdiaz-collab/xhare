-- Extender get_ride_detail_for_user para incluir paradas extra de pasajeros.

CREATE OR REPLACE FUNCTION public.get_ride_detail_for_user(p_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_uid uuid;
  v_ride rides%ROWTYPE;
  v_has_access boolean := false;
  v_stops jsonb;
  v_driver_profile jsonb;
  v_ride_json jsonb;
  v_passenger_extra_stops jsonb;
  v_result jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_ride FROM rides WHERE id = p_ride_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- (a) conductor del viaje
  IF v_ride.driver_id = v_uid THEN
    v_has_access := true;
  END IF;

  -- (b) admin
  IF NOT v_has_access AND is_admin(v_uid) THEN
    v_has_access := true;
  END IF;

  -- (c) pasajero con reserva activa
  IF NOT v_has_access AND EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.ride_id = p_ride_id
      AND b.passenger_id = v_uid
      AND b.status != 'cancelled'
  ) THEN
    v_has_access := true;
  END IF;

  IF NOT v_has_access THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', rs.id,
        'ride_id', rs.ride_id,
        'stop_order', rs.stop_order,
        'lat', rs.lat,
        'lng', rs.lng,
        'label', rs.label,
        'eta', rs.eta,
        'arrived_at', rs.arrived_at,
        'is_base_stop', rs.is_base_stop
      ) ORDER BY rs.stop_order
    ),
    '[]'::jsonb
  ) INTO v_stops
  FROM ride_stops rs
  WHERE rs.ride_id = p_ride_id;

  SELECT jsonb_build_object(
    'id', p.id,
    'full_name', p.full_name,
    'avatar_url', p.avatar_url,
    'rating_average', p.rating_average,
    'rating_count', p.rating_count
  ) INTO v_driver_profile
  FROM profiles p
  WHERE p.id = v_ride.driver_id;

  -- Solo campos usados por /rides/[id] (sin to_jsonb)
  v_ride_json := jsonb_build_object(
    'id', v_ride.id,
    'driver_id', v_ride.driver_id,
    'status', v_ride.status,
    'base_route_polyline', v_ride.base_route_polyline,
    'origin_lat', v_ride.origin_lat,
    'origin_lng', v_ride.origin_lng,
    'origin_label', v_ride.origin_label,
    'destination_lat', v_ride.destination_lat,
    'destination_lng', v_ride.destination_lng,
    'destination_label', v_ride.destination_label,
    'current_stop_index', v_ride.current_stop_index,
    'total_seats', v_ride.total_seats,
    'available_seats', v_ride.available_seats,
    'departure_time', v_ride.departure_time,
    'estimated_duration_minutes', v_ride.estimated_duration_minutes,
    'driver_lat', v_ride.driver_lat,
    'driver_lng', v_ride.driver_lng,
    'driver_location_updated_at', v_ride.driver_location_updated_at,
    'price_per_seat', v_ride.price_per_seat,
    'description', v_ride.description,
    'awaiting_stop_confirmation', v_ride.awaiting_stop_confirmation
  );

  -- Paradas extra de pasajeros:
  -- - Si el usuario es conductor o admin: todas las paradas extra del viaje.
  -- - Si es pasajero: solo sus propias paradas extra.
  IF v_ride.driver_id = v_uid OR is_admin(v_uid) THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', pes.id,
          'ride_id', pes.ride_id,
          'passenger_id', pes.passenger_id,
          'lat', pes.lat,
          'lng', pes.lng,
          'label', pes.label,
          'stop_order', pes.stop_order
        ) ORDER BY pes.passenger_id, pes.stop_order
      ),
      '[]'::jsonb
    ) INTO v_passenger_extra_stops
    FROM passenger_extra_stops pes
    WHERE pes.ride_id = p_ride_id;
  ELSE
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', pes.id,
          'ride_id', pes.ride_id,
          'passenger_id', pes.passenger_id,
          'lat', pes.lat,
          'lng', pes.lng,
          'label', pes.label,
          'stop_order', pes.stop_order
        ) ORDER BY pes.stop_order
      ),
      '[]'::jsonb
    ) INTO v_passenger_extra_stops
    FROM passenger_extra_stops pes
    WHERE pes.ride_id = p_ride_id
      AND pes.passenger_id = v_uid;
  END IF;

  v_result := jsonb_build_object(
    'ride', v_ride_json,
    'ride_stops', COALESCE(v_stops, '[]'::jsonb),
    'driver_profile', COALESCE(v_driver_profile, 'null'::jsonb),
    'passenger_extra_stops', COALESCE(v_passenger_extra_stops, '[]'::jsonb)
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_ride_detail_for_user(uuid) IS 'Detalle de un ride para conductor, admin o pasajero con reserva activa. Devuelve solo columnas usadas por /rides/[id] más paradas extra de pasajeros.';

