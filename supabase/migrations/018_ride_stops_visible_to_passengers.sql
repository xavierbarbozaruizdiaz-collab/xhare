-- Los pasajeros deben poder ver las paradas fijadas por el conductor en viajes publicados.
-- Sin esto, ride_stops solo es visible para el chofer y admins; el select anidado en reservar devuelve vacío.

CREATE POLICY "Anyone can view stops for published rides"
  ON ride_stops FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM rides
      WHERE rides.id = ride_stops.ride_id
      AND rides.status = 'published'
    )
  );

COMMENT ON POLICY "Anyone can view stops for published rides" ON ride_stops IS 'Permite que pasajeros vean paradas del conductor al reservar o ver un viaje publicado.';
