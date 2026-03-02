-- RPC para obtener detalle de un ride cuando el usuario es conductor, admin o pasajero con reserva activa.
-- Evita depender de RLS con subqueries que causan 42P17; uso seguro para /rides/[id] cuando status = en_route.

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

  v_result := jsonb_build_object(
    'ride', to_jsonb(v_ride),
    'ride_stops', COALESCE(v_stops, '[]'::jsonb),
    'driver_profile', COALESCE(v_driver_profile, 'null'::jsonb)
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_ride_detail_for_user(uuid) IS 'Detalle de un ride para conductor, admin o pasajero con reserva activa. Uso: fallback cuando RLS no devuelve la fila (ej. en_route).';

REVOKE ALL ON FUNCTION public.get_ride_detail_for_user(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_ride_detail_for_user(uuid) TO authenticated;

-- Checklist de pruebas (flujo sin recursión 42P17):
-- - Driver publica => OK (INSERT + SELECT por RLS)
-- - Pasajero search ve published => OK (SELECT status='published')
-- - Driver inicia viaje => status en_route => OK
-- - Pasajero con booking abre /rides/[id] en_route => OK vía RPC
-- - Pasajero sin booking no puede abrir en_route => RPC devuelve null => redirect /search
-- - Admin ve todo => OK (RLS o RPC)
