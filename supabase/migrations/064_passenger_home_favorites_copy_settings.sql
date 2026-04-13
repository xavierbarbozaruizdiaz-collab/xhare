-- Textos editables desde Admin para el bloque de favoritos en Inicio (app pasajero).
INSERT INTO settings (key, value)
VALUES
  ('passenger_home_favorites_title', to_jsonb('Hola. Configura tus favoritos para viajes rapidos.'::text)),
  (
    'passenger_home_favorites_subtitle',
    to_jsonb('Lista apilada con switch: activas solo el trayecto que quieras usar. Cada fila muestra la hora de recogida.'::text)
  )
ON CONFLICT (key) DO NOTHING;

-- Ampliar policy de lectura para usuarios autenticados en la app.
DROP POLICY IF EXISTS "Authenticated can read passenger_home_shortcuts_visible" ON settings;

CREATE POLICY "Authenticated can read passenger home UI settings"
  ON settings FOR SELECT
  TO authenticated
  USING (
    key IN (
      'passenger_home_shortcuts_visible',
      'passenger_home_favorites_title',
      'passenger_home_favorites_subtitle'
    )
  );
