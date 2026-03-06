-- Ver y asignar rol admin en la base de datos
-- Ejecutar en Supabase: SQL Editor

-- 1) VER todos los perfiles y sus roles (para verificar quién es admin)
SELECT id, role, full_name, phone
FROM public.profiles
ORDER BY role, full_name;

-- 2) VER el rol de un usuario por su email (reemplazá 'tu@email.com')
-- SELECT p.id, p.role, p.full_name, au.email
-- FROM public.profiles p
-- JOIN auth.users au ON au.id = p.id
-- WHERE au.email = 'tu@email.com';

-- 3) ASIGNAR rol admin a un usuario por email (ejecutar solo si tenés permiso)
-- Reemplazá 'admin@ejemplo.com' por el email del usuario que debe ser admin.
-- UPDATE public.profiles
-- SET role = 'admin'
-- WHERE id = (SELECT id FROM auth.users WHERE email = 'admin@ejemplo.com');

-- 4) Quitar rol admin (por si querés revertir)
-- UPDATE public.profiles
-- SET role = 'passenger'
-- WHERE id = (SELECT id FROM auth.users WHERE email = 'admin@ejemplo.com');
