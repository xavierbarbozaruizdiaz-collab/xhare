-- Días de la semana para atajos diarios (bits: 0=domingo … 6=sábado, igual que JS Date.getDay()).

ALTER TABLE public.passenger_home_map_shortcuts
  ADD COLUMN IF NOT EXISTS schedule_weekday_mask smallint NOT NULL DEFAULT 127;

COMMENT ON COLUMN public.passenger_home_map_shortcuts.schedule_weekday_mask IS
  'Solo con schedule_daily: bitmask 0=dom..6=sáb (Date.getDay). 127 = los 7 días.';
