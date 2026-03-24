-- Contraofertas de conductores sobre trip_requests (larga distancia).
-- Distinto de driver_offers (025), que apunta a passenger_ride_requests (flujo oferta antiguo).

CREATE TABLE IF NOT EXISTS trip_request_driver_offers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_request_id uuid NOT NULL REFERENCES trip_requests(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  proposed_price_per_seat_gs bigint NOT NULL CHECK (proposed_price_per_seat_gs > 0),
  message text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'withdrawn', 'accepted', 'rejected', 'expired')),
  ride_id uuid REFERENCES rides(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (trip_request_id, driver_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_req_driver_offers_request ON trip_request_driver_offers(trip_request_id);
CREATE INDEX IF NOT EXISTS idx_trip_req_driver_offers_driver ON trip_request_driver_offers(driver_id);
CREATE INDEX IF NOT EXISTS idx_trip_req_driver_offers_status ON trip_request_driver_offers(status) WHERE status = 'pending';

COMMENT ON TABLE trip_request_driver_offers IS 'Larga distancia: precio por asiento que propone cada conductor a una trip_request pendiente.';

ALTER TABLE trip_request_driver_offers ENABLE ROW LEVEL SECURITY;

-- Ver ofertas: pasajero dueño del pedido, o conductores/admin (para competir y ver precios).
CREATE POLICY "trip_request_driver_offers_select"
  ON trip_request_driver_offers FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM trip_requests tr
      WHERE tr.id = trip_request_driver_offers.trip_request_id
        AND tr.status = 'pending'
        AND (
          tr.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid() AND p.role IN ('driver', 'admin')
          )
        )
    )
  );

CREATE POLICY "trip_request_driver_offers_insert"
  ON trip_request_driver_offers FOR INSERT
  WITH CHECK (
    driver_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM trip_requests tr
      WHERE tr.id = trip_request_id
        AND tr.status = 'pending'
        AND tr.pricing_kind = 'long_distance'
    )
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role IN ('driver', 'admin')
    )
  );

CREATE POLICY "trip_request_driver_offers_update_own"
  ON trip_request_driver_offers FOR UPDATE
  USING (driver_id = auth.uid())
  WITH CHECK (driver_id = auth.uid());
