-- total_seats = capacidad del viaje; asientos restantes = total_seats - sum(bookings)
-- Para viajes existentes se asume que available_seats era la capacidad (por si el trigger no restó).

ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS total_seats int;

-- Capacidad del viaje: para existentes usamos el valor actual de available_seats como capacidad
UPDATE rides r
SET total_seats = COALESCE(r.available_seats, 15)
WHERE r.total_seats IS NULL;

-- Recalcular available_seats = total_seats - asientos ya reservados
UPDATE rides r
SET available_seats = GREATEST(0,
  COALESCE(r.total_seats, 15)
  - (SELECT COALESCE(SUM(b.seats_count), 0) FROM bookings b WHERE b.ride_id = r.id AND b.status != 'cancelled')
);

ALTER TABLE rides
  ALTER COLUMN total_seats SET DEFAULT 15;

COMMENT ON COLUMN rides.total_seats IS 'Capacidad total del viaje; asientos restantes = total_seats - sum(bookings.seats_count)';
