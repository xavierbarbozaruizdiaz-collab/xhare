-- Pestañas Rutas y Explorar en la app pasajero: ocultas por defecto, conmutables desde Admin.
INSERT INTO public.settings (key, value)
VALUES
  ('passenger_tab_rutas_visible', 'false'::jsonb),
  ('passenger_tab_explorar_visible', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated can read passenger home UI settings" ON public.settings;
DROP POLICY IF EXISTS "Authenticated can read mobile UI settings" ON public.settings;

CREATE POLICY "Authenticated can read mobile UI settings"
  ON public.settings FOR SELECT
  TO authenticated
  USING (
    key IN (
      'passenger_home_shortcuts_visible',
      'passenger_home_favorites_title',
      'passenger_home_favorites_subtitle',
      'passenger_pricing_polyline_visible',
      'driver_home_how_to',
      'passenger_tab_rutas_visible',
      'passenger_tab_explorar_visible'
    )
  );
