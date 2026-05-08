-- Controles de recarga desde app móvil:
-- - Avatar/foto vehículo: una sola carga por defecto; admin habilita recarga explícitamente.
-- - Documentos conductor: recarga solo cuando admin habilita.
-- - Storage de driver-vehicles: permitir carga del propio conductor (además de admin).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_reupload_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vehicle_photo_reupload_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.driver_documents
  ADD COLUMN IF NOT EXISTS reupload_enabled boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.profiles_enforce_media_reupload_locks()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  is_admin_actor boolean := false;
BEGIN
  BEGIN
    is_admin_actor := public.is_admin(auth.uid());
  EXCEPTION WHEN others THEN
    is_admin_actor := false;
  END;

  -- Service role / admin no tienen restricciones de recarga.
  IF auth.role() = 'service_role' OR is_admin_actor THEN
    RETURN NEW;
  END IF;

  -- Nadie fuera de admin puede habilitar flags de recarga manualmente.
  IF COALESCE(NEW.avatar_reupload_enabled, false) AND NOT COALESCE(OLD.avatar_reupload_enabled, false) THEN
    RAISE EXCEPTION 'avatar reupload must be enabled by admin';
  END IF;
  IF COALESCE(NEW.vehicle_photo_reupload_enabled, false) AND NOT COALESCE(OLD.vehicle_photo_reupload_enabled, false) THEN
    RAISE EXCEPTION 'vehicle photo reupload must be enabled by admin';
  END IF;

  -- Avatar: primera carga permitida. Reemplazo solo si admin habilitó recarga.
  IF NEW.avatar_url IS DISTINCT FROM OLD.avatar_url THEN
    IF OLD.avatar_url IS NOT NULL AND NOT COALESCE(OLD.avatar_reupload_enabled, false) THEN
      RAISE EXCEPTION 'avatar already uploaded; admin reupload required';
    END IF;
    NEW.avatar_reupload_enabled := false;
  END IF;

  -- Vehículo: primera carga permitida. Reemplazo solo si admin habilitó recarga.
  IF NEW.vehicle_photo_url IS DISTINCT FROM OLD.vehicle_photo_url THEN
    IF OLD.vehicle_photo_url IS NOT NULL AND NOT COALESCE(OLD.vehicle_photo_reupload_enabled, false) THEN
      RAISE EXCEPTION 'vehicle photo already uploaded; admin reupload required';
    END IF;
    NEW.vehicle_photo_reupload_enabled := false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_enforce_media_reupload_locks ON public.profiles;
CREATE TRIGGER trg_profiles_enforce_media_reupload_locks
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.profiles_enforce_media_reupload_locks();

DROP POLICY IF EXISTS "Drivers update own documents as pending" ON public.driver_documents;
CREATE POLICY "Drivers update own documents as pending when enabled"
  ON public.driver_documents
  FOR UPDATE
  TO authenticated
  USING (
    driver_id = auth.uid()
    AND reupload_enabled = true
  )
  WITH CHECK (
    driver_id = auth.uid()
    AND status = 'pending'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND reupload_enabled = false
  );

DROP POLICY IF EXISTS "Admin insert driver vehicles" ON storage.objects;
DROP POLICY IF EXISTS "Admin update driver vehicles" ON storage.objects;
DROP POLICY IF EXISTS "Admin delete driver vehicles" ON storage.objects;

DROP POLICY IF EXISTS "Drivers insert own driver vehicles objects" ON storage.objects;
CREATE POLICY "Drivers insert own driver vehicles objects"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'driver-vehicles'
    AND (
      split_part(name, '/', 1) = auth.uid()::text
      OR public.is_admin(auth.uid())
    )
  );

DROP POLICY IF EXISTS "Drivers update own driver vehicles objects" ON storage.objects;
CREATE POLICY "Drivers update own driver vehicles objects"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'driver-vehicles'
    AND (
      split_part(name, '/', 1) = auth.uid()::text
      OR public.is_admin(auth.uid())
    )
  )
  WITH CHECK (
    bucket_id = 'driver-vehicles'
    AND (
      split_part(name, '/', 1) = auth.uid()::text
      OR public.is_admin(auth.uid())
    )
  );

DROP POLICY IF EXISTS "Drivers delete own driver vehicles objects" ON storage.objects;
CREATE POLICY "Drivers delete own driver vehicles objects"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'driver-vehicles'
    AND (
      split_part(name, '/', 1) = auth.uid()::text
      OR public.is_admin(auth.uid())
    )
  );
