# Instrucciones para Migración a Modelo BlaBlaCar

## ⚠️ IMPORTANTE: Ejecutar Migración de Base de Datos

Antes de usar el nuevo sistema, debes ejecutar la migración en Supabase:

### Paso 1: Abrir Supabase SQL Editor
1. Ve a tu proyecto en [Supabase Dashboard](https://app.supabase.com)
2. Navega a **SQL Editor** en el menú lateral

### Paso 2: Ejecutar la Migración
1. Abre el archivo `supabase/migrations/004_blablacar_model.sql`
2. Copia todo el contenido
3. Pégalo en el SQL Editor de Supabase
4. Haz clic en **Run** o presiona `Ctrl+Enter` (Windows) / `Cmd+Enter` (Mac)

### Paso 3: Verificar la Migración
La migración debería ejecutarse sin errores. Verifica que:
- ✅ Se agregaron nuevos campos a la tabla `rides`
- ✅ Se creó la tabla `bookings`
- ✅ Se creó la tabla `reviews`
- ✅ Se creó la tabla `messages`
- ✅ Se agregaron campos a la tabla `profiles`

## 🎯 Cambios Principales en el Sistema

### Antes (Sistema de Matching Automático):
- Pasajeros creaban solicitudes
- Admin ejecutaba matching
- Sistema agrupaba pasajeros
- Admin asignaba choferes

### Ahora (Modelo BlaBlaCar):
- Choferes publican viajes directamente
- Pasajeros buscan y reservan asientos
- Choferes aceptan/rechazan reservas
- Sistema más simple y directo

## 📍 Nuevas Rutas

- `/` - Homepage con búsqueda (tipo BlaBlaCar)
- `/search` - Resultados de búsqueda de viajes
- `/publish` - Publicar un nuevo viaje (choferes)
- `/rides/[id]` - Detalles de un viaje y reserva
- `/my-rides` - Mis viajes publicados (choferes)
- `/my-bookings` - Mis reservas (pasajeros)

## 🔄 Migración de Datos Existentes (Opcional)

Si tienes datos del sistema anterior, puedes migrarlos:

```sql
-- Convertir rides existentes al nuevo formato (si aplica)
-- Nota: Esto es solo un ejemplo, ajusta según tus necesidades
UPDATE rides 
SET 
  status = 'published',
  origin_label = 'Origen',
  destination_label = 'Destino',
  price_per_seat = 1000,
  available_seats = capacity
WHERE status IN ('building', 'ready');
```

## ✅ Verificación Post-Migración

1. **Probar como Chofer:**
   - Inicia sesión como chofer
   - Ve a "Publicar viaje"
   - Completa el formulario y publica
   - Verifica que aparece en "Mis viajes"

2. **Probar como Pasajero:**
   - Busca un viaje desde la homepage
   - Haz clic en un viaje para ver detalles
   - Intenta reservar un asiento
   - Verifica que aparece en "Mis reservas"

3. **Probar Reservas:**
   - Como chofer, ve a "Mis viajes"
   - Deberías ver las reservas pendientes
   - Acepta o rechaza una reserva
   - Verifica que los asientos disponibles se actualizan

## 🐛 Solución de Problemas

### Error: "column does not exist"
- Asegúrate de ejecutar la migración completa
- Verifica que todos los campos fueron creados

### Error: "permission denied"
- Verifica las políticas RLS en Supabase
- La migración incluye políticas básicas, pero puedes ajustarlas

### Los viajes no aparecen
- Verifica que el status sea 'published'
- Revisa los filtros de búsqueda

## 📚 Documentación Adicional

- `CAMBIOS_BLABLACAR.md` - Lista completa de cambios
- `PLAN_TRANSFORMACION_BLABLACAR.md` - Plan detallado de transformación
