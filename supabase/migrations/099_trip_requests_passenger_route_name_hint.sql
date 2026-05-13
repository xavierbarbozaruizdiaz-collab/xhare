-- Opcional: referencia del pasajero al nombre del viaje (similar a rides.route_name en publicación).
ALTER TABLE public.trip_requests
  ADD COLUMN IF NOT EXISTS passenger_route_name_hint text;

COMMENT ON COLUMN public.trip_requests.passenger_route_name_hint IS
  'Opcional: nombre o etiqueta que el pasajero asocia al viaje (p. ej. coincide con route_name del conductor).';
