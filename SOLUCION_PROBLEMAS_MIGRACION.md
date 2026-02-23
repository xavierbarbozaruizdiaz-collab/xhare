# Solución de Problemas - Migración BlaBlaCar

## El servidor se ve igual después de la migración

Si aplicaste la migración pero el servidor se ve igual, sigue estos pasos:

### 1. Verificar que la migración se ejecutó correctamente

Ve a: `http://localhost:3000/test-migration`

Esta página verificará automáticamente:
- ✅ Si las nuevas columnas existen en `rides`
- ✅ Si las tablas `bookings`, `reviews`, `messages` existen
- ✅ Si las nuevas columnas en `profiles` existen
- ✅ Si puedes consultar viajes publicados

### 2. Limpiar caché del navegador

**Windows/Linux:**
- Presiona `Ctrl + Shift + R` o `Ctrl + F5`
- O abre DevTools (F12) → Click derecho en el botón de recargar → "Vaciar caché y volver a cargar"

**Mac:**
- Presiona `Cmd + Shift + R`
- O abre DevTools (Cmd + Option + I) → Click derecho en el botón de recargar → "Vaciar caché y volver a cargar"

### 3. Verificar errores en la consola

1. Abre DevTools (F12)
2. Ve a la pestaña "Console"
3. Busca errores en rojo
4. Si ves errores sobre columnas que no existen, la migración no se aplicó correctamente

### 4. Verificar en Supabase

1. Ve a tu proyecto en Supabase
2. Abre **Table Editor**
3. Selecciona la tabla `rides`
4. Verifica que veas estas columnas:
   - `origin_lat`
   - `origin_lng`
   - `origin_label`
   - `destination_lat`
   - `destination_lng`
   - `destination_label`
   - `price_per_seat`
   - `available_seats`
   - `description`
   - `vehicle_info`

5. Verifica que existan las tablas:
   - `bookings`
   - `reviews`
   - `messages`

### 5. Si la migración no se aplicó

1. Ve a Supabase SQL Editor
2. Copia TODO el contenido de `supabase/migrations/004_blablacar_model.sql`
3. Pégalo en el SQL Editor
4. Ejecuta la migración
5. Verifica que no haya errores
6. Recarga el navegador con caché limpio

### 6. Reiniciar el servidor de desarrollo

Si hiciste cambios y no se reflejan:

```bash
# Detén el servidor (Ctrl+C)
# Luego reinícialo
npm run dev
```

### 7. Verificar que estás en la página correcta

Las nuevas páginas son:
- `/` - Nueva homepage tipo BlaBlaCar
- `/search` - Búsqueda de viajes
- `/publish` - Publicar viaje
- `/my-rides` - Mis viajes (choferes)
- `/my-bookings` - Mis reservas (pasajeros)

Si estás en `/app` o `/driver`, esas son las páginas antiguas.

### 8. Probar publicar un viaje

1. Inicia sesión como chofer
2. Ve a `/publish`
3. Completa el formulario
4. Publica el viaje
5. Ve a `/my-rides` para verlo

Si hay errores al publicar, verifica:
- Que todas las columnas existan (usa `/test-migration`)
- Que el status sea 'published' (no 'building' o 'ready')
- Que los campos obligatorios estén completos

### 9. Errores comunes

**Error: "column X does not exist"**
- La migración no se aplicó completamente
- Ejecuta la migración nuevamente en Supabase

**Error: "permission denied"**
- Las políticas RLS pueden estar bloqueando
- Verifica las políticas en Supabase → Authentication → Policies

**No aparecen viajes en la búsqueda**
- Verifica que los viajes tengan `status = 'published'`
- Verifica que tengan `available_seats > 0`
- Verifica que la fecha de `departure_time` sea futura

**La página se ve igual**
- Limpia la caché del navegador
- Verifica que estés en la URL correcta (`/` no `/app`)
- Reinicia el servidor de desarrollo

## Contacto

Si después de seguir estos pasos aún tienes problemas, comparte:
1. Los errores de la consola del navegador
2. Los resultados de `/test-migration`
3. Capturas de pantalla de Supabase Table Editor
