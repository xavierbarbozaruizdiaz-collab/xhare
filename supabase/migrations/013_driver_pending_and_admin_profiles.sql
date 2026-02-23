-- Conductores requieren aprobación del admin. Nuevo rol driver_pending.
-- Los pasajeros se habilitan sin aprobación.

-- 1. Permitir rol 'driver_pending' en profiles
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('passenger', 'driver', 'admin', 'driver_pending'));

-- 2. Al registrarse como conductor, crear perfil con role = driver_pending (no driver)
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_role text := 'passenger';
  user_full_name text;
  user_phone text;
BEGIN
  IF NEW.raw_user_meta_data->>'role' IS NOT NULL THEN
    user_role := NEW.raw_user_meta_data->>'role';
    -- Si pide ser conductor, queda pendiente de aprobación
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

  INSERT INTO public.profiles (id, role, full_name, phone)
  VALUES (NEW.id, user_role, user_full_name, user_phone)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Admin puede actualizar cualquier perfil (para aprobar/rechazar conductores)
DROP POLICY IF EXISTS "Admins can update all profiles" ON profiles;
CREATE POLICY "Admins can update all profiles"
  ON profiles FOR UPDATE
  USING (is_admin(auth.uid()));

COMMENT ON CONSTRAINT profiles_role_check ON profiles IS 'passenger=sin aprobación, driver=aprobado por admin, driver_pending=esperando aprobación, admin=administrador';
