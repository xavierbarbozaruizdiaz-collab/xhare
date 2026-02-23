-- Solo conductores aprobados por admin pueden configurar vehículo y publicar.
-- driver_approved_at se setea cuando el admin aprueba (driver_pending -> driver).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS driver_approved_at timestamptz;

COMMENT ON COLUMN profiles.driver_approved_at IS 'Fecha en que un admin aprobó al conductor; null = no aprobado o no es conductor.';

-- Conductores que ya existen se consideran aprobados
UPDATE profiles
SET driver_approved_at = COALESCE(driver_approved_at, created_at, now())
WHERE role = 'driver' AND driver_approved_at IS NULL;
