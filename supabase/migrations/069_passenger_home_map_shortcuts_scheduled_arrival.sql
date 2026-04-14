-- Hora de llegada deseada (modo llegada en la app) además de scheduled_time = recogida estimada.

ALTER TABLE public.passenger_home_map_shortcuts
  ADD COLUMN IF NOT EXISTS scheduled_arrival_time text NULL;

COMMENT ON COLUMN public.passenger_home_map_shortcuts.scheduled_arrival_time IS
  'HH:mm hora de llegada al destino si el pasajero configuró por llegada; scheduled_time sigue siendo salida/recogida estimada.';
