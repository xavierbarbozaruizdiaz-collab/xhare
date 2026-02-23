-- Opciones de horario de salida para el conductor
-- strict_5 = Salgo en el horario marcado, variación máx. 5 min
-- flexible_30 = Hago la ruta, variación máx. 30 min

ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS departure_flexibility text DEFAULT 'strict_5'
  CHECK (departure_flexibility IN ('strict_5', 'flexible_30'));
