-- Bloqueo de datos del vehículo (marca, modelo, año, asientos): una sola carga;
-- admin habilita vehicle_data_reupload_enabled para permitir edición.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS vehicle_make text,
  ADD COLUMN IF NOT EXISTS vehicle_data_reupload_enabled boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.profiles_enforce_media_reupload_locks()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  is_admin_actor boolean := false;
  old_vehicle_complete boolean := false;
  vehicle_data_changed boolean := false;
BEGIN
  BEGIN
    is_admin_actor := public.is_admin(auth.uid());
  EXCEPTION WHEN others THEN
    is_admin_actor := false;
  END;

  IF auth.role() = 'service_role' OR is_admin_actor THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.avatar_reupload_enabled, false) AND NOT COALESCE(OLD.avatar_reupload_enabled, false) THEN
    RAISE EXCEPTION 'avatar reupload must be enabled by admin';
  END IF;
  IF COALESCE(NEW.vehicle_photo_reupload_enabled, false) AND NOT COALESCE(OLD.vehicle_photo_reupload_enabled, false) THEN
    RAISE EXCEPTION 'vehicle photo reupload must be enabled by admin';
  END IF;
  IF COALESCE(NEW.vehicle_data_reupload_enabled, false) AND NOT COALESCE(OLD.vehicle_data_reupload_enabled, false) THEN
    RAISE EXCEPTION 'vehicle data reupload must be enabled by admin';
  END IF;

  IF NEW.avatar_url IS DISTINCT FROM OLD.avatar_url THEN
    IF OLD.avatar_url IS NOT NULL AND NOT COALESCE(OLD.avatar_reupload_enabled, false) THEN
      RAISE EXCEPTION 'avatar already uploaded; admin reupload required';
    END IF;
    NEW.avatar_reupload_enabled := false;
  END IF;

  IF NEW.vehicle_photo_url IS DISTINCT FROM OLD.vehicle_photo_url THEN
    IF OLD.vehicle_photo_url IS NOT NULL AND NOT COALESCE(OLD.vehicle_photo_reupload_enabled, false) THEN
      RAISE EXCEPTION 'vehicle photo already uploaded; admin reupload required';
    END IF;
    NEW.vehicle_photo_reupload_enabled := false;
  END IF;

  old_vehicle_complete :=
    btrim(coalesce(OLD.vehicle_model, '')) <> ''
    AND OLD.vehicle_year IS NOT NULL
    AND OLD.vehicle_seat_count IS NOT NULL;

  vehicle_data_changed :=
    NEW.vehicle_model IS DISTINCT FROM OLD.vehicle_model
    OR NEW.vehicle_year IS DISTINCT FROM OLD.vehicle_year
    OR NEW.vehicle_seat_count IS DISTINCT FROM OLD.vehicle_seat_count
    OR NEW.vehicle_seat_layout IS DISTINCT FROM OLD.vehicle_seat_layout
    OR NEW.vehicle_make IS DISTINCT FROM OLD.vehicle_make;

  IF vehicle_data_changed THEN
    IF old_vehicle_complete AND NOT COALESCE(OLD.vehicle_data_reupload_enabled, false) THEN
      RAISE EXCEPTION 'vehicle data already set; admin reupload required';
    END IF;
    NEW.vehicle_data_reupload_enabled := false;
  END IF;

  RETURN NEW;
END;
$$;
