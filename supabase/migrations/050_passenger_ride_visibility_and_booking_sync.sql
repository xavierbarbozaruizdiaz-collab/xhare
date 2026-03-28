-- Pasajero: poder leer rides donde tiene reserva (booked/en_route/completed) sin recursión RLS.
-- Al completar viaje: marcar reservas no canceladas como completed.
-- Al iniciar viaje (en_route): pasar reservas pending → confirmed (evita "Pendiente" eterno).

CREATE OR REPLACE FUNCTION public.passenger_has_non_cancelled_booking(p_ride_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.ride_id = p_ride_id
      AND b.passenger_id = auth.uid()
      AND b.status <> 'cancelled'
  );
$$;

COMMENT ON FUNCTION public.passenger_has_non_cancelled_booking(uuid) IS
  'True si el usuario actual tiene una reserva no cancelada en ese ride. SECURITY DEFINER evita recursión RLS rides↔bookings.';

-- rides: pasajeros con reserva ven el viaje (cualquier estado del ride mientras la reserva siga activa en listado).
DROP POLICY IF EXISTS "Anyone can view published rides" ON public.rides;
CREATE POLICY "Anyone can view published rides"
  ON public.rides
  FOR SELECT
  USING (
    status = 'published'
    OR driver_id = auth.uid()
    OR public.is_admin(auth.uid())
    OR public.passenger_has_non_cancelled_booking(id)
  );

-- ride_stops: mismo criterio que el ride visible para el pasajero.
DROP POLICY IF EXISTS "Anyone can view stops for published rides" ON public.ride_stops;
CREATE POLICY "Anyone can view stops for published rides"
  ON public.ride_stops
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.rides r
      WHERE r.id = ride_stops.ride_id
        AND (
          r.status = 'published'
          OR r.driver_id = auth.uid()
          OR public.is_admin(auth.uid())
          OR public.passenger_has_non_cancelled_booking(r.id)
        )
    )
  );

COMMENT ON POLICY "Anyone can view stops for published rides" ON public.ride_stops IS
  'Paradas: viaje publicado, conductor, admin, o pasajero con reserva no cancelada.';

-- Sincronizar estados de reservas con el viaje.
CREATE OR REPLACE FUNCTION public.sync_bookings_on_ride_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'en_route' AND (OLD.status IS DISTINCT FROM 'en_route') THEN
    UPDATE public.bookings
    SET status = 'confirmed',
        updated_at = now()
    WHERE ride_id = NEW.id
      AND status = 'pending';
  END IF;

  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    UPDATE public.bookings
    SET status = 'completed',
        updated_at = now()
    WHERE ride_id = NEW.id
      AND status <> 'cancelled';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_bookings_on_ride_status_change() IS
  'Ride en_route → bookings pending→confirmed; ride completed → bookings no canceladas→completed.';

DROP TRIGGER IF EXISTS trigger_sync_bookings_on_ride_status ON public.rides;
CREATE TRIGGER trigger_sync_bookings_on_ride_status
  AFTER UPDATE OF status ON public.rides
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_bookings_on_ride_status_change();
