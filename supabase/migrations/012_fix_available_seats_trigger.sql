-- El trigger que actualiza available_seats debe ejecutarse con privilegios de definer
-- para poder actualizar rides aunque quien inserta el booking sea un pasajero (RLS).
-- Recalcula siempre: available_seats = total_seats - sum(bookings no cancelados).

CREATE OR REPLACE FUNCTION update_ride_available_seats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ride_id_val uuid;
BEGIN
  ride_id_val := COALESCE(NEW.ride_id, OLD.ride_id);
  UPDATE rides r
  SET available_seats = GREATEST(0,
    COALESCE(r.total_seats, 15) - (
      SELECT COALESCE(SUM(b.seats_count), 0)
      FROM bookings b
      WHERE b.ride_id = r.id AND b.status != 'cancelled'
    )
  )
  WHERE r.id = ride_id_val;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_available_seats ON bookings;
CREATE TRIGGER trigger_update_available_seats
  AFTER INSERT OR UPDATE OF seats_count, status OR DELETE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION update_ride_available_seats();

COMMENT ON FUNCTION update_ride_available_seats() IS 'Recalcula rides.available_seats desde total_seats y bookings. SECURITY DEFINER para evitar bloqueo por RLS.';

-- RPC para que la lista de viajes pueda obtener asientos reservados por ride sin exponer datos de pasajeros (RLS).
CREATE OR REPLACE FUNCTION get_ride_booked_seats(ride_ids uuid[])
RETURNS TABLE(ride_id uuid, booked_seats bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT b.ride_id, COALESCE(SUM(b.seats_count), 0)::bigint
  FROM bookings b
  WHERE b.ride_id = ANY(ride_ids) AND b.status != 'cancelled'
  GROUP BY b.ride_id
$$;

COMMENT ON FUNCTION get_ride_booked_seats(uuid[]) IS 'Devuelve total de asientos reservados por ride_id para listados públicos.';
GRANT EXECUTE ON FUNCTION get_ride_booked_seats(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION get_ride_booked_seats(uuid[]) TO anon;

-- RPC para detalle del viaje: asientos reservados y puntos de recogida/descenso (para ruta y lista "otros pasajeros").
-- Cualquier usuario puede ver estos datos agregados sin ver quién reservó.
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
BEGIN
  RETURN QUERY
  SELECT
    COALESCE((SELECT SUM(b.seats_count)::bigint FROM bookings b WHERE b.ride_id = p_ride_id AND b.status != 'cancelled'), 0),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('lat', b.pickup_lat, 'lng', b.pickup_lng, 'label', b.pickup_label))
      FROM bookings b
      WHERE b.ride_id = p_ride_id AND b.status != 'cancelled' AND b.pickup_lat IS NOT NULL AND b.pickup_lng IS NOT NULL
    ), '[]'::jsonb),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('lat', b.dropoff_lat, 'lng', b.dropoff_lng, 'label', b.dropoff_label))
      FROM bookings b
      WHERE b.ride_id = p_ride_id AND b.status != 'cancelled' AND b.dropoff_lat IS NOT NULL AND b.dropoff_lng IS NOT NULL
    ), '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION get_ride_public_info(uuid) IS 'Para detalle del viaje: asientos reservados y puntos recogida/descenso (ruta actualizada y lista otros pasajeros).';
GRANT EXECUTE ON FUNCTION get_ride_public_info(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_ride_public_info(uuid) TO anon;
