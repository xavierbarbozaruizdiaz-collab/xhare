-- Comentario opcional en calificaciones (pasajero→conductor y conductor→pasajero).

ALTER TABLE public.driver_ratings
  ADD COLUMN IF NOT EXISTS comment text;

ALTER TABLE public.passenger_ratings
  ADD COLUMN IF NOT EXISTS comment text;

COMMENT ON COLUMN public.driver_ratings.comment IS 'Comentario opcional del pasajero al calificar al conductor.';
COMMENT ON COLUMN public.passenger_ratings.comment IS 'Comentario opcional del conductor al calificar al pasajero.';
