-- Idempotencia de push: inicio de trayecto y acercamiento a subida.

ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS en_route_push_sent_at timestamptz;

COMMENT ON COLUMN rides.en_route_push_sent_at IS 'Cuándo se envió push de inicio de trayecto a pasajeros.';

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS pickup_approach_push_sent_at timestamptz;

COMMENT ON COLUMN bookings.pickup_approach_push_sent_at IS 'Cuándo se envió push de acercamiento del conductor al punto de subida.';
