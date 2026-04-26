-- Registro de aceptación legal (TyC / Privacidad) por usuario.
-- Mantiene compatibilidad: columnas nuevas nullable + trigger extendido.

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
ADD COLUMN IF NOT EXISTS privacy_accepted_at timestamptz,
ADD COLUMN IF NOT EXISTS terms_version text,
ADD COLUMN IF NOT EXISTS privacy_version text;

-- Extender trigger de creación de perfil para tomar aceptación legal desde auth metadata.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_role text := 'passenger';
  user_full_name text;
  user_phone text;
  user_terms_accepted_at timestamptz;
  user_privacy_accepted_at timestamptz;
  user_terms_version text;
  user_privacy_version text;
BEGIN
  IF NEW.raw_user_meta_data->>'role' IS NOT NULL THEN
    user_role := NEW.raw_user_meta_data->>'role';
    IF user_role = 'driver' THEN
      user_role := 'driver_pending';
    END IF;
  END IF;

  IF NEW.raw_user_meta_data->>'full_name' IS NOT NULL THEN
    user_full_name := NEW.raw_user_meta_data->>'full_name';
  END IF;

  IF NEW.raw_user_meta_data->>'phone' IS NOT NULL THEN
    user_phone := NEW.raw_user_meta_data->>'phone';
  END IF;

  IF NEW.raw_user_meta_data->>'terms_accepted_at' IS NOT NULL THEN
    user_terms_accepted_at := (NEW.raw_user_meta_data->>'terms_accepted_at')::timestamptz;
  END IF;

  IF NEW.raw_user_meta_data->>'privacy_accepted_at' IS NOT NULL THEN
    user_privacy_accepted_at := (NEW.raw_user_meta_data->>'privacy_accepted_at')::timestamptz;
  END IF;

  IF NEW.raw_user_meta_data->>'terms_version' IS NOT NULL THEN
    user_terms_version := NEW.raw_user_meta_data->>'terms_version';
  END IF;

  IF NEW.raw_user_meta_data->>'privacy_version' IS NOT NULL THEN
    user_privacy_version := NEW.raw_user_meta_data->>'privacy_version';
  END IF;

  INSERT INTO public.profiles (
    id,
    role,
    full_name,
    phone,
    terms_accepted_at,
    privacy_accepted_at,
    terms_version,
    privacy_version
  )
  VALUES (
    NEW.id,
    user_role,
    user_full_name,
    user_phone,
    user_terms_accepted_at,
    user_privacy_accepted_at,
    user_terms_version,
    user_privacy_version
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON COLUMN public.profiles.terms_accepted_at IS 'Fecha/hora de aceptación de TyC.';
COMMENT ON COLUMN public.profiles.privacy_accepted_at IS 'Fecha/hora de aceptación de Política de Privacidad.';
COMMENT ON COLUMN public.profiles.terms_version IS 'Versión de TyC aceptada por el usuario.';
COMMENT ON COLUMN public.profiles.privacy_version IS 'Versión de Privacidad aceptada por el usuario.';
