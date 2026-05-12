-- Switch admin: mostrar/ocultar la ruta usada para pricing (auditoría visual en app pasajero).
INSERT INTO settings (key, value)
VALUES ('passenger_pricing_polyline_visible', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Mantener lectura autenticada para todas las claves de UI pasajero.
DROP POLICY IF EXISTS "Authenticated can read passenger home UI settings" ON settings;

CREATE POLICY "Authenticated can read passenger home UI settings"
  ON settings FOR SELECT
  TO authenticated
  USING (
    key IN (
      'passenger_home_shortcuts_visible',
      'passenger_home_favorites_title',
      'passenger_home_favorites_subtitle',
      'passenger_pricing_polyline_visible'
    )
  );
