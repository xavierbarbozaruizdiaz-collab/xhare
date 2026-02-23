-- Datos del conductor: domicilio y ciudad (para solicitudes y admin)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS city text;

COMMENT ON COLUMN profiles.address IS 'Domicilio del conductor (para registro y admin).';
COMMENT ON COLUMN profiles.city IS 'Ciudad del conductor (para registro y admin).';
 