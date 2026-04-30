-- Solucion de fondo: garantizar contrato auth.users -> public.profiles
-- 1) Backfill de perfiles faltantes
-- 2) Trigger robusto para altas futuras
-- 3) Default de role para evitar filas invalidas por omision

ALTER TABLE public.profiles
ALTER COLUMN role SET DEFAULT 'passenger';

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
  END IF;

  -- Normalizar roles permitidos. Conductores nuevos quedan pending.
  IF user_role = 'driver' THEN
    user_role := 'driver_pending';
  ELSIF user_role NOT IN ('passenger', 'driver_pending', 'admin') THEN
    user_role := 'passenger';
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Backfill integral para usuarios historicos sin fila en profiles.
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
SELECT
  u.id,
  CASE
    WHEN COALESCE(u.raw_user_meta_data->>'role', '') = 'driver' THEN 'driver_pending'
    WHEN COALESCE(u.raw_user_meta_data->>'role', '') IN ('passenger', 'driver_pending', 'admin') THEN u.raw_user_meta_data->>'role'
    ELSE 'passenger'
  END AS role,
  NULLIF(TRIM(COALESCE(u.raw_user_meta_data->>'full_name', '')), '') AS full_name,
  NULLIF(TRIM(COALESCE(u.raw_user_meta_data->>'phone', '')), '') AS phone,
  CASE
    WHEN u.raw_user_meta_data->>'terms_accepted_at' IS NOT NULL
      THEN (u.raw_user_meta_data->>'terms_accepted_at')::timestamptz
    ELSE NULL
  END AS terms_accepted_at,
  CASE
    WHEN u.raw_user_meta_data->>'privacy_accepted_at' IS NOT NULL
      THEN (u.raw_user_meta_data->>'privacy_accepted_at')::timestamptz
    ELSE NULL
  END AS privacy_accepted_at,
  NULLIF(TRIM(COALESCE(u.raw_user_meta_data->>'terms_version', '')), '') AS terms_version,
  NULLIF(TRIM(COALESCE(u.raw_user_meta_data->>'privacy_version', '')), '') AS privacy_version
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;
