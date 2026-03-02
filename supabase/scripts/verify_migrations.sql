-- Script para verificar que las migraciones 034, 035 y 036 están aplicadas correctamente.
-- Ejecutar en Supabase Dashboard → SQL Editor (o con psql conectado al proyecto).

-- 1) RLS en rides: debe existir la policy "Anyone can view published rides" con USING sin subquery a bookings
SELECT
  schemaname,
  tablename,
  policyname,
  cmd,
  qual IS NOT NULL AS has_using,
  with_check IS NOT NULL AS has_with_check
FROM pg_policies
WHERE tablename = 'rides'
ORDER BY policyname;

-- 2) Función get_ride_detail_for_user debe existir y ser ejecutable por authenticated
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_arguments(p.oid) AS arguments,
  CASE p.prosecdef WHEN true THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS security
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'get_ride_detail_for_user';

-- 3) Permiso EXECUTE para authenticated
SELECT
  grantee,
  privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name = 'get_ride_detail_for_user'
  AND grantee = 'authenticated';

-- Si las tres consultas devuelven filas coherentes, las migraciones están aplicadas.
-- Esperado: 5 policies en rides; 1 fila para la función (SECURITY DEFINER); EXECUTE para authenticated.
