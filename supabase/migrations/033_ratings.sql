-- Calificaciones Driver/Passenger con privacidad.
-- Un rating por ride por usuario (unique). Pasajero califica chofer; chofer califica pasajero solo si bajó.

-- 1.1 Tabla: driver_ratings (pasajero → chofer)
CREATE TABLE IF NOT EXISTS driver_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  passenger_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  stars int NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(ride_id, passenger_id)
);

CREATE INDEX IF NOT EXISTS idx_driver_ratings_driver_id ON driver_ratings(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_ratings_passenger_id ON driver_ratings(passenger_id);
CREATE INDEX IF NOT EXISTS idx_driver_ratings_ride_id ON driver_ratings(ride_id);

COMMENT ON TABLE driver_ratings IS 'Calificación del pasajero al chofer (1-5). Una por ride por pasajero.';

-- 1.2 Tabla: passenger_ratings (chofer → pasajero)
CREATE TABLE IF NOT EXISTS passenger_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  passenger_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  stars int NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(ride_id, passenger_id)
);

CREATE INDEX IF NOT EXISTS idx_passenger_ratings_driver_id ON passenger_ratings(driver_id);
CREATE INDEX IF NOT EXISTS idx_passenger_ratings_passenger_id ON passenger_ratings(passenger_id);
CREATE INDEX IF NOT EXISTS idx_passenger_ratings_ride_id ON passenger_ratings(ride_id);

COMMENT ON TABLE passenger_ratings IS 'Calificación del chofer al pasajero (1-5). Solo si el pasajero bajó. Una por ride por pasajero.';

-- 2) RLS
ALTER TABLE driver_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE passenger_ratings ENABLE ROW LEVEL SECURITY;

-- 2.1 driver_ratings
-- INSERT: solo pasajero con booking no cancelado en ese ride
CREATE POLICY "Passenger can insert own driver rating with booking"
  ON driver_ratings FOR INSERT
  WITH CHECK (
    passenger_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.ride_id = driver_ratings.ride_id
        AND b.passenger_id = auth.uid()
        AND b.status != 'cancelled'
    )
  );

-- SELECT: pasajero ve los suyos; chofer ve los que lo califican
CREATE POLICY "Passenger can view own driver ratings"
  ON driver_ratings FOR SELECT
  USING (passenger_id = auth.uid());

CREATE POLICY "Driver can view ratings about them"
  ON driver_ratings FOR SELECT
  USING (driver_id = auth.uid());

-- 2.2 passenger_ratings
-- INSERT: solo chofer del ride; validación de dropped_off se hace en API (RLS no puede ver ride_boarding_events fácilmente en WITH CHECK)
-- Permitimos INSERT si driver_id = auth.uid() y el ride es del driver; la API exige dropped_off
CREATE POLICY "Driver can insert passenger rating for own ride"
  ON passenger_ratings FOR INSERT
  WITH CHECK (
    driver_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM rides r
      WHERE r.id = passenger_ratings.ride_id AND r.driver_id = auth.uid()
    )
  );

-- SELECT: pasajero ve calificaciones recibidas; chofer ve las que emitió
CREATE POLICY "Passenger can view received passenger ratings"
  ON passenger_ratings FOR SELECT
  USING (passenger_id = auth.uid());

CREATE POLICY "Driver can view own given passenger ratings"
  ON passenger_ratings FOR SELECT
  USING (driver_id = auth.uid());
