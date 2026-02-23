-- Para que en la pantalla de reservar se muestren las subidas y bajadas de otros pasajeros
-- en el mapa, los pasajeros deben poder leer las reservas del viaje (al menos coordenadas).
-- Sin esta política, un pasajero solo ve su propia reserva y existingPickups/existingDropoffs quedan vacíos.

CREATE POLICY "Users can view bookings for published rides (route display)"
  ON bookings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM rides
      WHERE rides.id = bookings.ride_id
      AND rides.status = 'published'
    )
  );

COMMENT ON POLICY "Users can view bookings for published rides (route display)" ON bookings IS 'Permite ver reservas de un viaje publicado para mostrar en el mapa las subidas/bajadas de otros pasajeros al reservar.';
