-- Posición en vivo del conductor durante el viaje (en_route).
-- La app del conductor envía lat/lng periódicamente; pasajeros ven el punto en el mapa.
ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS driver_lat double precision,
  ADD COLUMN IF NOT EXISTS driver_lng double precision,
  ADD COLUMN IF NOT EXISTS driver_location_updated_at timestamptz;

COMMENT ON COLUMN rides.driver_lat IS 'Última latitud reportada por el conductor durante el viaje (en_route).';
COMMENT ON COLUMN rides.driver_lng IS 'Última longitud reportada por el conductor durante el viaje (en_route).';
COMMENT ON COLUMN rides.driver_location_updated_at IS 'Momento del último reporte de ubicación del conductor.';
