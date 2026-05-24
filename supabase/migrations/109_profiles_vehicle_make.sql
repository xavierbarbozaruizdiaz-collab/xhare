-- Marca del vehículo (separada del modelo en profiles.vehicle_model)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS vehicle_make text;

COMMENT ON COLUMN profiles.vehicle_make IS 'Vehicle brand/make (marca)';
