-- Script para convertir un usuario en administrador
-- Reemplaza 'tu_email@ejemplo.com' con el email de tu usuario

UPDATE profiles
SET role = 'admin'
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'tu_email@ejemplo.com'
);

-- Verificar que se actualizó correctamente
SELECT 
  p.id,
  u.email,
  p.role,
  p.full_name
FROM profiles p
JOIN auth.users u ON u.id = p.id
WHERE u.email = 'tu_email@ejemplo.com';

