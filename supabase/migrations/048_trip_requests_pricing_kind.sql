-- Tipo de solicitud de trayecto: interno (cotizacion ya recibida) vs larga distancia (precio deseado, negociable).

ALTER TABLE trip_requests
  ADD COLUMN IF NOT EXISTS pricing_kind text NOT NULL DEFAULT 'internal';

ALTER TABLE trip_requests DROP CONSTRAINT IF EXISTS trip_requests_pricing_kind_check;
ALTER TABLE trip_requests
  ADD CONSTRAINT trip_requests_pricing_kind_check
  CHECK (pricing_kind IN ('internal', 'long_distance'));

ALTER TABLE trip_requests
  ADD COLUMN IF NOT EXISTS passenger_desired_price_per_seat_gs bigint;

ALTER TABLE trip_requests
  ADD COLUMN IF NOT EXISTS internal_quote_acknowledged boolean;

COMMENT ON COLUMN trip_requests.pricing_kind IS 'internal | long_distance (alineado a publicacion de viajes).';
COMMENT ON COLUMN trip_requests.passenger_desired_price_per_seat_gs IS 'Solo larga distancia: precio que el pasajero quiere pagar por asiento (Gs), referencia para negociacion.';
COMMENT ON COLUMN trip_requests.internal_quote_acknowledged IS 'Solo interno: pasajero confirma que ya recibio cotizacion del costo.';
