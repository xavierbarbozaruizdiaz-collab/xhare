-- Bucket y políticas para fotos de vehículos de conductores (gestionadas por admin).
-- profiles.vehicle_photo_url ya existe en el esquema base; si faltara en algún entorno, se crea.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS vehicle_photo_url text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'driver-vehicles',
  'driver-vehicles',
  true,
  3145728,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Public read driver vehicles" ON storage.objects;
CREATE POLICY "Public read driver vehicles"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'driver-vehicles');

DROP POLICY IF EXISTS "Admin insert driver vehicles" ON storage.objects;
CREATE POLICY "Admin insert driver vehicles"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'driver-vehicles'
    AND public.is_admin(auth.uid())
  );

DROP POLICY IF EXISTS "Admin update driver vehicles" ON storage.objects;
CREATE POLICY "Admin update driver vehicles"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'driver-vehicles'
    AND public.is_admin(auth.uid())
  )
  WITH CHECK (
    bucket_id = 'driver-vehicles'
    AND public.is_admin(auth.uid())
  );

DROP POLICY IF EXISTS "Admin delete driver vehicles" ON storage.objects;
CREATE POLICY "Admin delete driver vehicles"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'driver-vehicles'
    AND public.is_admin(auth.uid())
  );
