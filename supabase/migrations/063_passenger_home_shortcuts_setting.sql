-- Visibilidad del bloque “buscador + accesos + alertas” en Inicio (pasajero), controlada desde admin.
INSERT INTO settings (key, value)
VALUES ('passenger_home_shortcuts_visible', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Los pasajeros autenticados pueden leer solo esta clave (el resto de settings sigue solo admin).
CREATE POLICY "Authenticated can read passenger_home_shortcuts_visible"
  ON settings FOR SELECT
  TO authenticated
  USING (key = 'passenger_home_shortcuts_visible');
