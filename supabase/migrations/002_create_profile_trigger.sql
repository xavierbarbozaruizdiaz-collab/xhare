-- Function to handle new user creation
-- This function creates a profile automatically when a user signs up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_role text := 'passenger'; -- Default role
  user_full_name text;
  user_phone text;
BEGIN
  -- Extract role from user metadata if available
  IF NEW.raw_user_meta_data->>'role' IS NOT NULL THEN
    user_role := NEW.raw_user_meta_data->>'role';
  END IF;
  
  -- Extract full_name from user metadata if available
  IF NEW.raw_user_meta_data->>'full_name' IS NOT NULL THEN
    user_full_name := NEW.raw_user_meta_data->>'full_name';
  END IF;
  
  -- Extract phone from user metadata if available
  IF NEW.raw_user_meta_data->>'phone' IS NOT NULL THEN
    user_phone := NEW.raw_user_meta_data->>'phone';
  END IF;
  
  -- Insert profile with role from metadata or default to 'passenger'
  INSERT INTO public.profiles (id, role, full_name, phone)
  VALUES (
    NEW.id,
    user_role,
    user_full_name,
    user_phone
  )
  ON CONFLICT (id) DO NOTHING; -- Prevent errors if profile already exists
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if it exists (to make migration idempotent)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Trigger to automatically create profile when a new user is created
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- Drop policy if it exists (to make migration idempotent)
DROP POLICY IF EXISTS "System can create profiles via trigger" ON profiles;

-- Policy to allow automatic profile creation (used by trigger)
CREATE POLICY "System can create profiles via trigger"
  ON profiles FOR INSERT
  WITH CHECK (true);

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON public.profiles TO authenticated;
