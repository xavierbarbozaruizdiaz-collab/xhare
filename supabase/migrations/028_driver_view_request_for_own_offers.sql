-- El conductor puede ver la solicitud (origen, destino, fecha) de las ofertas que envió,
-- aunque la solicitud ya esté cerrada (ej. oferta aceptada). Así en "Mis ofertas" se muestran los datos.
DROP POLICY IF EXISTS "Drivers view passenger_ride_requests they offered on" ON passenger_ride_requests;
CREATE POLICY "Drivers view passenger_ride_requests they offered on"
  ON passenger_ride_requests FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM driver_offers drv_off
      WHERE drv_off.passenger_request_id = passenger_ride_requests.id
        AND drv_off.driver_id = auth.uid()
    )
  );
