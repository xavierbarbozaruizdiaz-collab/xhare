-- Permitir que usuarios autenticados vean perfiles de otros (nombre, avatar, valoración, vehículo)
-- para listados de viajes, ofertas recibidas, etc.
DROP POLICY IF EXISTS "Authenticated users can view all profiles" ON profiles;
CREATE POLICY "Authenticated users can view all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);
