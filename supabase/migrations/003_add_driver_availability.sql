-- Add available column to profiles table for driver availability
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS available boolean DEFAULT false;

-- Create index for faster queries on available drivers
CREATE INDEX IF NOT EXISTS idx_profiles_available_driver 
ON profiles(available) 
WHERE role = 'driver' AND available = true;

-- Add comment
COMMENT ON COLUMN profiles.available IS 'Indicates if driver is available for new ride assignments';
