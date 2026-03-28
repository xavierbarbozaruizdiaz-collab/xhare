-- Viajes en curso con cupo: usuarios autenticados pueden leer ride + paradas para reservar / mapa en vivo.
-- No anon: auth.uid() IS NOT NULL. Mitiga scraping público frente a exponer todos los en_route sin login.

DROP POLICY IF EXISTS "Anyone can view published rides" ON public.rides;
CREATE POLICY "Anyone can view published rides"
  ON public.rides
  FOR SELECT
  USING (
    status = 'published'
    OR (
      status = 'en_route'
      AND available_seats > 0
      AND auth.uid() IS NOT NULL
    )
    OR driver_id = auth.uid()
    OR public.is_admin(auth.uid())
    OR public.passenger_has_non_cancelled_booking(id)
  );

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
          OR (
            r.status = 'en_route'
            AND r.available_seats > 0
            AND auth.uid() IS NOT NULL
          )
          OR r.driver_id = auth.uid()
          OR public.is_admin(auth.uid())
          OR public.passenger_has_non_cancelled_booking(r.id)
        )
    )
  );

COMMENT ON POLICY "Anyone can view published rides" ON public.rides IS
  'Publicados para todos; en_route con cupos solo si hay sesión; conductor/admin/pasajero con reserva.';
