-- Ubicación en vivo del pasajero mientras espera la subida (viaje en_route).
-- El conductor la ve solo en la parada de recogida activa; no reemplaza pickup_lat/lng de la reserva.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS passenger_lat double precision,
  ADD COLUMN IF NOT EXISTS passenger_lng double precision,
  ADD COLUMN IF NOT EXISTS passenger_location_updated_at timestamptz;

COMMENT ON COLUMN bookings.passenger_lat IS 'Última latitud del pasajero compartida durante el viaje (espera de subida).';
COMMENT ON COLUMN bookings.passenger_lng IS 'Última longitud del pasajero compartida durante el viaje (espera de subida).';
COMMENT ON COLUMN bookings.passenger_location_updated_at IS 'Momento del último reporte de ubicación del pasajero.';
