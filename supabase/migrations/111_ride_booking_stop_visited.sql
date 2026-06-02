-- Conductor pasó por el punto del recorrido sin registrar subida/bajada (acción opcional en "Llegué").
ALTER TABLE ride_boarding_events
  DROP CONSTRAINT IF EXISTS ride_boarding_events_event_type_check;

ALTER TABLE ride_boarding_events
  ADD CONSTRAINT ride_boarding_events_event_type_check
  CHECK (event_type IN ('boarded', 'no_show', 'dropped_off', 'stop_visited'));

COMMENT ON COLUMN ride_boarding_events.event_type IS
  'boarded, no_show, dropped_off, stop_visited (pasó el punto sin acción de pasajero en Llegué)';
