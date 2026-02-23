-- Conductor: vehículo, cantidad de asientos y distribución (tipo aerolínea).
-- El pasajero podrá elegir asiento al reservar.

-- Perfil del conductor: capacidad y layout del vehículo
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS vehicle_seat_count int,
  ADD COLUMN IF NOT EXISTS vehicle_seat_layout jsonb;

COMMENT ON COLUMN profiles.vehicle_seat_count IS 'Cantidad de asientos del vehículo del conductor (2-15).';
COMMENT ON COLUMN profiles.vehicle_seat_layout IS 'Distribución por filas, ej: {"rows":[2,2,3]} = 3 filas con 2, 2 y 3 asientos.';

-- Viaje: copia del layout del conductor para saber qué asientos hay
ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS seat_layout jsonb;

COMMENT ON COLUMN rides.seat_layout IS 'Misma estructura que vehicle_seat_layout; define los asientos del viaje.';

-- Reserva: asientos elegidos por el pasajero (ej: ["1A","1B","2A"])
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS selected_seat_ids text[];

COMMENT ON COLUMN bookings.selected_seat_ids IS 'IDs de asientos elegidos por el pasajero (ej: 1A, 1B, 2A).';
