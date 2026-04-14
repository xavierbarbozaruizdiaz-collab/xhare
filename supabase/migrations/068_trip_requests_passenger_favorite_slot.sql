-- Origen del pedido: slot de favorito de Inicio / búsqueda (no altera pricing_kind).

ALTER TABLE public.trip_requests
  ADD COLUMN IF NOT EXISTS passenger_favorite_slot text NULL;

COMMENT ON COLUMN public.trip_requests.passenger_favorite_slot IS
  'Si la solicitud se generó desde un favorito guardado, id del preset (ej. home_to_work).';
