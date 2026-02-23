# Instrucciones para Ejecutar Migraciones en Supabase

## 📋 Migraciones Disponibles

Hay **2 migraciones** que necesitas ejecutar en Supabase:

1. **001_initial_schema.sql** - Esquema inicial (tablas, políticas RLS, funciones)
2. **002_create_profile_trigger.sql** - Trigger para crear perfiles automáticamente ⚠️ **NUEVA**

## ⚠️ IMPORTANTE: Migración Faltante

Si ya ejecutaste la migración `001_initial_schema.sql`, **necesitas ejecutar la nueva migración `002_create_profile_trigger.sql`** para que el sistema funcione correctamente.

Sin esta migración:
- ❌ Los perfiles NO se crearán automáticamente cuando un usuario se registra
- ❌ El sistema de roles NO funcionará
- ❌ Los usuarios no podrán usar la aplicación correctamente

## 🚀 Cómo Ejecutar las Migraciones

### Opción 1: Ejecutar Ambas Migraciones (Si no has ejecutado ninguna)

1. Ve a tu proyecto en [Supabase Dashboard](https://app.supabase.com)
2. Selecciona tu proyecto
3. Ve a **SQL Editor** (en el menú lateral)
4. Abre el archivo `supabase/migrations/001_initial_schema.sql`
5. Copia **TODO** el contenido
6. Pégalo en el SQL Editor
7. Haz clic en **Run** o presiona `Ctrl+Enter`
8. Espera a que termine (puede tardar unos segundos)
9. Repite los pasos 4-7 con `supabase/migrations/002_create_profile_trigger.sql`

### Opción 2: Solo Ejecutar la Nueva Migración (Si ya ejecutaste la primera)

Si ya ejecutaste `001_initial_schema.sql` anteriormente:

1. Ve a **SQL Editor** en Supabase Dashboard
2. Abre el archivo `supabase/migrations/002_create_profile_trigger.sql`
3. Copia **TODO** el contenido
4. Pégalo en el SQL Editor
5. Haz clic en **Run** o presiona `Ctrl+Enter`
6. Verifica que no haya errores

## ✅ Verificar que Funcionó

Después de ejecutar las migraciones, verifica que todo esté correcto:

### 1. Verificar que el Trigger Existe

Ejecuta esta query en SQL Editor:

```sql
SELECT 
  trigger_name, 
  event_manipulation, 
  event_object_table,
  action_statement
FROM information_schema.triggers
WHERE trigger_name = 'on_auth_user_created';
```

Deberías ver una fila con el trigger `on_auth_user_created`.

### 2. Verificar que la Función Existe

```sql
SELECT 
  routine_name, 
  routine_type
FROM information_schema.routines
WHERE routine_name = 'handle_new_user';
```

Deberías ver la función `handle_new_user`.

### 3. Probar Creando un Usuario

1. Ve a tu aplicación y crea un nuevo usuario
2. Ve a **Authentication** → **Users** en Supabase Dashboard
3. Verifica que el usuario se haya creado
4. Ve a **Table Editor** → **profiles**
5. Verifica que se haya creado automáticamente un perfil para ese usuario con el rol correcto

## 🔧 Qué Hace la Nueva Migración

La migración `002_create_profile_trigger.sql` crea:

1. **Función `handle_new_user()`**:
   - Se ejecuta automáticamente cuando se crea un nuevo usuario
   - Extrae el `role`, `full_name` y `phone` de los metadatos del usuario
   - Crea automáticamente un registro en la tabla `profiles`
   - Si no se especifica rol, usa 'passenger' por defecto

2. **Trigger `on_auth_user_created`**:
   - Se activa después de insertar un usuario en `auth.users`
   - Llama automáticamente a la función `handle_new_user()`

3. **Política RLS**:
   - Permite que el sistema cree perfiles automáticamente

## 🐛 Solución de Problemas

### Error: "function handle_new_user() already exists"

Si ves este error, significa que el trigger ya existe. Puedes:
- Ignorar el error (el trigger ya está funcionando)
- O ejecutar: `DROP FUNCTION IF EXISTS handle_new_user() CASCADE;` y luego ejecutar la migración nuevamente

### Error: "trigger on_auth_user_created already exists"

Similar al anterior, el trigger ya existe. Puedes ignorarlo o eliminarlo primero.

### Los perfiles no se crean automáticamente

1. Verifica que el trigger existe (usando las queries de verificación arriba)
2. Verifica que la función existe
3. Revisa los logs en Supabase Dashboard → Logs → Postgres Logs
4. Asegúrate de que los usuarios se están creando correctamente en `auth.users`

## 📝 Notas Importantes

- ⚠️ **Ejecuta las migraciones en orden**: Primero `001`, luego `002`
- ⚠️ **No ejecutes las migraciones dos veces** si ya las ejecutaste (a menos que quieras recrearlas)
- ✅ **Las migraciones son idempotentes**: Usan `CREATE OR REPLACE` y `IF NOT EXISTS` donde es posible
- ✅ **Los datos existentes no se perderán**: Las migraciones solo agregan funcionalidad nueva

## 🎯 Después de Ejecutar

Una vez ejecutadas ambas migraciones:

1. ✅ Los usuarios se crearán automáticamente con su perfil
2. ✅ El rol se asignará según lo que el usuario seleccione al registrarse
3. ✅ El sistema de badges y visualización de roles funcionará correctamente
4. ✅ Los usuarios podrán usar todas las funcionalidades de la aplicación
