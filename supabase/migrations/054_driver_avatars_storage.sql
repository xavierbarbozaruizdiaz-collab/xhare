-- Bucket y políticas para fotos de conductores administradas desde panel admin.
-- Objetivo: escritura solo admin; lectura pública para consumo en app/web vía avatar_url.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'driver-avatars',
  'driver-avatars',
  true,
  3145728,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Lectura pública del bucket (URLs públicas).
DROP POLICY IF EXISTS "Public read driver avatars" ON storage.objects;
CREATE POLICY "Public read driver avatars"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'driver-avatars');

-- Solo admin puede subir objetos al bucket.
DROP POLICY IF EXISTS "Admin insert driver avatars" ON storage.objects;
CREATE POLICY "Admin insert driver avatars"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'driver-avatars'
    AND public.is_admin(auth.uid())
  );

-- Solo admin puede actualizar objetos del bucket.
DROP POLICY IF EXISTS "Admin update driver avatars" ON storage.objects;
CREATE POLICY "Admin update driver avatars"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'driver-avatars'
    AND public.is_admin(auth.uid())
  )
  WITH CHECK (
    bucket_id = 'driver-avatars'
    AND public.is_admin(auth.uid())
  );

-- Solo admin puede eliminar objetos del bucket.
DROP POLICY IF EXISTS "Admin delete driver avatars" ON storage.objects;
CREATE POLICY "Admin delete driver avatars"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'driver-avatars'
    AND public.is_admin(auth.uid())
  );
