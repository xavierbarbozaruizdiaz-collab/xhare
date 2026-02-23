-- Hora en que el pasajero quiere que lo recojan (obligatoria al crear solicitud).
-- Permite agrupar por fecha y hora en la vista conductor y prellenar la hora al publicar.

ALTER TABLE trip_requests
  ADD COLUMN IF NOT EXISTS requested_time time;

-- Valores existentes: hora por defecto 08:00
UPDATE trip_requests
  SET requested_time = '08:00'
  WHERE requested_time IS NULL;

ALTER TABLE trip_requests
  ALTER COLUMN requested_time SET DEFAULT '08:00',
  ALTER COLUMN requested_time SET NOT NULL;

COMMENT ON COLUMN trip_requests.requested_time IS 'Hora en que el pasajero quiere que lo recojan (obligatoria al guardar solicitud).';
