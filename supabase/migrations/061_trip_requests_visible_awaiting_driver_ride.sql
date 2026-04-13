-- Pasajeros vinculados a rides awaiting_driver: lectura para mapas/listados de despacho (mismo criterio que published).
DROP POLICY IF EXISTS "Anyone can view accepted trip_requests for published rides" ON public.trip_requests;
CREATE POLICY "Anyone can view accepted trip_requests for published rides"
  ON public.trip_requests FOR SELECT
  USING (
    status = 'accepted'
    AND ride_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = trip_requests.ride_id
        AND r.status IN ('published', 'awaiting_driver')
    )
  );

COMMENT ON POLICY "Anyone can view accepted trip_requests for published rides" ON public.trip_requests IS
  'Ver solicitudes aceptadas de un viaje publicado o en awaiting_driver (mapa y cupo despacho).';
