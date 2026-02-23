-- Permitir reservar hasta la capacidad del móvil (antes el CHECK limitaba a 8 asientos).
-- Sin afectar el resto de la lógica ni las migraciones existentes.

ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS bookings_seats_count_check;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_seats_count_check
  CHECK (seats_count > 0 AND seats_count <= 50);

COMMENT ON CONSTRAINT bookings_seats_count_check ON bookings IS 'Entre 1 y 50 asientos por reserva (capacidad típica del móvil).';
