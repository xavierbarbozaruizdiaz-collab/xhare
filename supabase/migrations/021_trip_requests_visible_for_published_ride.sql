-- Para que en la página de ver viaje se muestren en el mapa las paradas de los pasajeros
-- que vienen de solicitudes aceptadas (trip_requests con ride_id y status = 'accepted'),
-- cualquiera que pueda ver el viaje publicado debe poder leer esas filas (solo para mostrar puntos en el mapa).

CREATE POLICY "Anyone can view accepted trip_requests for published rides"
  ON trip_requests FOR SELECT
  USING (
    status = 'accepted'
    AND ride_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM rides r
      WHERE r.id = trip_requests.ride_id
      AND r.status = 'published'
    )
  );

COMMENT ON POLICY "Anyone can view accepted trip_requests for published rides" ON trip_requests IS
  'Permite ver solicitudes aceptadas de un viaje publicado para mostrar subidas/bajadas en el mapa.';
