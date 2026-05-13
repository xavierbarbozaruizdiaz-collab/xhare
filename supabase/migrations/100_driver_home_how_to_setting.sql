-- Texto editable desde Admin: card "¿Cómo empezar?" en Inicio (app conductor).
INSERT INTO public.settings (key, value)
VALUES (
  'driver_home_how_to',
  jsonb_build_object(
    'title',
    '¿CÓMO EMPEZAR?',
    'lines',
    jsonb_build_array(
      '1. Publicá una ruta con horario y cupos.',
      '2. Los pasajeros reservan desde la app.',
      '3. Confirmá el viaje, cobrá y sumá calificación.'
    )
  )
)
ON CONFLICT (key) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated can read passenger home UI settings" ON public.settings;

CREATE POLICY "Authenticated can read mobile UI settings"
  ON public.settings FOR SELECT
  TO authenticated
  USING (
    key IN (
      'passenger_home_shortcuts_visible',
      'passenger_home_favorites_title',
      'passenger_home_favorites_subtitle',
      'passenger_pricing_polyline_visible',
      'driver_home_how_to'
    )
  );
