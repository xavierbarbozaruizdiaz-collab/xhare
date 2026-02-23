-- Columnas para ruta base y desvío (publicar viaje sin depender de otra migración)
-- Ejecutar en: app.supabase.com → tu proyecto → SQL Editor

-- rides: polyline de la ruta base (array de {lat, lng}) y desvío máximo en km
ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS base_route_polyline jsonb,
  ADD COLUMN IF NOT EXISTS max_deviation_km numeric(4,2) DEFAULT 1.0;

-- ride_stops: marcar paradas base (origen/destino) para validaciones
ALTER TABLE ride_stops
  ADD COLUMN IF NOT EXISTS is_base_stop boolean DEFAULT false;

-- Índices opcionales para consultas por ruta
CREATE INDEX IF NOT EXISTS idx_rides_base_route ON rides USING gin (base_route_polyline) WHERE base_route_polyline IS NOT NULL;

COMMENT ON COLUMN rides.base_route_polyline IS 'Array de puntos {lat, lng} de la ruta base (OSRM)';
COMMENT ON COLUMN rides.max_deviation_km IS 'Desvío máximo en km para recoger/dejar pasajeros';
COMMENT ON COLUMN ride_stops.is_base_stop IS 'True para origen y destino del viaje';

-- Conductores pueden insertar/actualizar paradas de sus propios viajes (al publicar o editar ruta)
DROP POLICY IF EXISTS "Drivers can insert stops for their rides" ON ride_stops;
CREATE POLICY "Drivers can insert stops for their rides"
  ON ride_stops FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM rides
      WHERE rides.id = ride_stops.ride_id AND rides.driver_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Drivers can update stops for their rides" ON ride_stops;
CREATE POLICY "Drivers can update stops for their rides"
  ON ride_stops FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM rides
      WHERE rides.id = ride_stops.ride_id AND rides.driver_id = auth.uid()
    )
  );
