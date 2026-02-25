-- Flujo B: Iniciar viaje → Llegué (Subió/No subió) → Continuar → Finalizar
-- Campos en rides y ride_stops; tabla ride_boarding_events; RLS para pasajeros en en_route

-- 1) rides: started_at, current_stop_index, awaiting_stop_confirmation
ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS current_stop_index int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS awaiting_stop_confirmation boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN rides.started_at IS 'Momento en que el conductor inició el viaje (status → en_route).';
COMMENT ON COLUMN rides.current_stop_index IS 'Índice de la parada actual (0 = primera), para flujo Llegué/Continuar.';
COMMENT ON COLUMN rides.awaiting_stop_confirmation IS 'True mientras el conductor debe confirmar pasajeros en el modal antes de Continuar.';

-- 2) ride_stops: arrived_at
ALTER TABLE ride_stops
  ADD COLUMN IF NOT EXISTS arrived_at timestamptz;

COMMENT ON COLUMN ride_stops.arrived_at IS 'Momento en que el conductor marcó llegada a esta parada.';

-- 3) ride_boarding_events: decisiones Subió / No subió / Bajó por parada
CREATE TABLE IF NOT EXISTS ride_boarding_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  stop_index int NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('boarded', 'no_show', 'dropped_off')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(ride_id, booking_id, stop_index, event_type)
);

CREATE INDEX IF NOT EXISTS idx_ride_boarding_events_ride ON ride_boarding_events(ride_id);
CREATE INDEX IF NOT EXISTS idx_ride_boarding_events_booking ON ride_boarding_events(booking_id);

COMMENT ON TABLE ride_boarding_events IS 'Eventos de subida/bajada por parada: boarded, no_show, dropped_off.';

ALTER TABLE ride_boarding_events ENABLE ROW LEVEL SECURITY;

-- Conductores ven eventos de sus viajes; pasajeros ven solo los de sus bookings
CREATE POLICY "Drivers can manage boarding events for their rides"
  ON ride_boarding_events FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM rides
      WHERE rides.id = ride_boarding_events.ride_id AND rides.driver_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM rides
      WHERE rides.id = ride_boarding_events.ride_id AND rides.driver_id = auth.uid()
    )
  );

CREATE POLICY "Passengers can view their own boarding events"
  ON ride_boarding_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM bookings
      WHERE bookings.id = ride_boarding_events.booking_id AND bookings.passenger_id = auth.uid()
    )
  );

-- 4) RLS: pasajeros con reserva activa pueden ver el ride cuando está en_route
DROP POLICY IF EXISTS "Anyone can view published rides" ON rides;
CREATE POLICY "Anyone can view published rides"
  ON rides FOR SELECT
  USING (
    status = 'published'
    OR driver_id = auth.uid()
    OR is_admin(auth.uid())
    OR (
      status = 'en_route'
      AND EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.ride_id = rides.id AND b.passenger_id = auth.uid() AND b.status != 'cancelled'
      )
    )
  );

-- 5) RLS: quien puede ver el ride puede ver ride_stops cuando está published o en_route
DROP POLICY IF EXISTS "Anyone can view stops for published rides" ON ride_stops;
CREATE POLICY "Anyone can view stops for published rides"
  ON ride_stops FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM rides r
      WHERE r.id = ride_stops.ride_id
      AND (
        r.status = 'published'
        OR r.driver_id = auth.uid()
        OR is_admin(auth.uid())
        OR (
          r.status = 'en_route'
          AND EXISTS (
            SELECT 1 FROM bookings b
            WHERE b.ride_id = r.id AND b.passenger_id = auth.uid() AND b.status != 'cancelled'
          )
        )
      )
    )
  );

COMMENT ON POLICY "Anyone can view stops for published rides" ON ride_stops IS 'Ver paradas cuando el viaje está publicado o en curso y el usuario es driver, admin o pasajero con reserva.';
