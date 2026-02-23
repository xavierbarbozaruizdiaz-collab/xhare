-- Texto e email que ve el conductor pendiente (editable desde el panel admin)
INSERT INTO settings (key, value)
VALUES (
  'driver_pending_instructions',
  '{"email":"","message":"Enviá el resto de los documentos por correo al email que te indiquemos. Cuando tu solicitud sea aprobada podrás publicar viajes."}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- Permitir a admins insertar en settings (para upsert desde el panel)
DROP POLICY IF EXISTS "Admins can insert settings" ON settings;
CREATE POLICY "Admins can insert settings"
  ON settings FOR INSERT
  WITH CHECK (is_admin(auth.uid()));
