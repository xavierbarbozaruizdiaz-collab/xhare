-- Bucket y politicas para media de landing /descargar (hero + screenshots).
-- Solucion de fondo: escritura restringida a admin desde panel, lectura publica para render web.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'app-releases',
  'app-releases',
  true,
  8388608,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Public read app releases" ON storage.objects;
CREATE POLICY "Public read app releases"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'app-releases');

DROP POLICY IF EXISTS "Admin insert app releases" ON storage.objects;
CREATE POLICY "Admin insert app releases"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'app-releases'
    AND public.is_admin(auth.uid())
  );

DROP POLICY IF EXISTS "Admin update app releases" ON storage.objects;
CREATE POLICY "Admin update app releases"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'app-releases'
    AND public.is_admin(auth.uid())
  )
  WITH CHECK (
    bucket_id = 'app-releases'
    AND public.is_admin(auth.uid())
  );

DROP POLICY IF EXISTS "Admin delete app releases" ON storage.objects;
CREATE POLICY "Admin delete app releases"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'app-releases'
    AND public.is_admin(auth.uid())
  );
