-- Tabla para paradas extra definidas por pasajeros dentro de un viaje concreto.
-- Cada pasajero puede definir hasta 3 paradas adicionales por viaje.

CREATE TABLE IF NOT EXISTS passenger_extra_stops (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  passenger_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  label text,
  stop_order smallint NOT NULL CHECK (stop_order BETWEEN 1 AND 3),
  created_at timestamptz DEFAULT now()
);

-- Índices para consultas típicas (por viaje y por pasajero)
CREATE INDEX IF NOT EXISTS idx_passenger_extra_stops_ride
  ON passenger_extra_stops(ride_id);

CREATE INDEX IF NOT EXISTS idx_passenger_extra_stops_passenger
  ON passenger_extra_stops(passenger_id);

-- Garantizar máximo 3 paradas por pasajero y viaje (1..3)
ALTER TABLE passenger_extra_stops
  ADD CONSTRAINT passenger_extra_stops_unique_per_order
  UNIQUE (ride_id, passenger_id, stop_order);

-- Habilitar RLS
ALTER TABLE passenger_extra_stops ENABLE ROW LEVEL SECURITY;

-- El pasajero puede crear/editar/borrar solo sus propias paradas extra
CREATE POLICY "Passengers can manage their own extra stops"
  ON passenger_extra_stops
  FOR ALL
  USING (passenger_id = auth.uid())
  WITH CHECK (passenger_id = auth.uid());

-- El conductor del viaje y los admins pueden ver todas las paradas extra de ese viaje
CREATE POLICY "Driver and admins can view extra stops for their rides"
  ON passenger_extra_stops
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM rides
      WHERE rides.id = passenger_extra_stops.ride_id
        AND (rides.driver_id = auth.uid() OR is_admin(auth.uid()))
    )
  );

