-- Snapshot de pricing por reserva: congelar valores usados y auditoría.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS pricing_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS pricing_settings_id uuid REFERENCES pricing_settings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS segment_distance_km numeric(6,3),
  ADD COLUMN IF NOT EXISTS base_fare int;

COMMENT ON COLUMN bookings.pricing_snapshot IS 'JSON con valores 100%, effective, km, base, seats, total, round_to, block_* y pricing_settings_id usados al confirmar.';
COMMENT ON COLUMN bookings.segment_distance_km IS 'Distancia del tramo recogida-bajada en km.';
COMMENT ON COLUMN bookings.base_fare IS 'Tarifa base (1 asiento) en PYG al momento de la reserva.';
