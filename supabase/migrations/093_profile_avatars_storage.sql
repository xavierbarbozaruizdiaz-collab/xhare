-- Avatar de perfil autogestionado desde app móvil (pasajero y conductor).
-- Bucket público para lectura directa del avatar_url, con escritura restringida por carpeta del usuario.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'profile-avatars',
  'profile-avatars',
  true,
  3145728,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Public read profile avatars" ON storage.objects;
CREATE POLICY "Public read profile avatars"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'profile-avatars');

DROP POLICY IF EXISTS "Users insert own profile avatars" ON storage.objects;
CREATE POLICY "Users insert own profile avatars"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'profile-avatars'
    AND (
      split_part(name, '/', 1) = auth.uid()::text
      OR public.is_admin(auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users update own profile avatars" ON storage.objects;
CREATE POLICY "Users update own profile avatars"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'profile-avatars'
    AND (
      split_part(name, '/', 1) = auth.uid()::text
      OR public.is_admin(auth.uid())
    )
  )
  WITH CHECK (
    bucket_id = 'profile-avatars'
    AND (
      split_part(name, '/', 1) = auth.uid()::text
      OR public.is_admin(auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users delete own profile avatars" ON storage.objects;
CREATE POLICY "Users delete own profile avatars"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'profile-avatars'
    AND (
      split_part(name, '/', 1) = auth.uid()::text
      OR public.is_admin(auth.uid())
    )
  );
