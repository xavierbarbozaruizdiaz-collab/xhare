-- Confirmar email del usuario de prueba y asignar rol conductor
-- Ejecutar en Supabase → SQL Editor (como postgres/superuser)
-- Reemplazá el email si usaste otro al crear la cuenta.

DO $$
DECLARE
  uid uuid;
BEGIN
  SELECT id INTO uid FROM auth.users WHERE email = 'conductor-test@xhare.local' LIMIT 1;
  IF uid IS NOT NULL THEN
    UPDATE auth.users SET email_confirmed_at = now() WHERE id = uid;
    UPDATE public.profiles SET role = 'driver' WHERE id = uid;
    RAISE NOTICE 'Usuario conductor-test@xhare.local confirmado y rol driver asignado.';
  ELSE
    RAISE NOTICE 'No se encontró usuario con email conductor-test@xhare.local. Creá la cuenta desde la app primero.';
  END IF;
END $$;
