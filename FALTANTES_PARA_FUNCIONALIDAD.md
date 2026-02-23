# Lo que falta para que Xhare sea completamente funcional

## 🔴 CRÍTICO - Debe hacerse para que funcione

### 1. Políticas RLS (Row Level Security) para `rides`
**Problema**: Las políticas actuales solo permiten que choferes vean sus viajes asignados, pero NO permiten:
- ❌ Que choferes CREEN rides (INSERT)
- ❌ Que todos vean rides publicados para búsqueda (SELECT)
- ❌ Que choferes actualicen sus propios rides (UPDATE)

**Solución**: Agregar estas políticas en Supabase:
```sql
-- Permitir que choferes creen rides
CREATE POLICY "Drivers can create rides"
  ON rides FOR INSERT
  WITH CHECK (
    driver_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'driver'
    )
  );

-- Permitir que todos vean rides publicados
CREATE POLICY "Anyone can view published rides"
  ON rides FOR SELECT
  USING (status = 'published');

-- Permitir que choferes actualicen sus propios rides
CREATE POLICY "Drivers can update their own rides"
  ON rides FOR UPDATE
  USING (driver_id = auth.uid())
  WITH CHECK (driver_id = auth.uid());
```

### 2. Validación de rol en página `/publish`
**Problema**: La página permite que cualquier usuario autenticado publique viajes, incluso pasajeros.

**Solución**: Agregar validación en `src/app/publish/page.tsx`:
```typescript
// En checkUser(), después de cargar el perfil:
if (profile.role !== 'driver') {
  alert('Solo los choferes pueden publicar viajes');
  router.push('/');
  return;
}
```

### 3. Validación de rol para reservas
**Problema**: No hay validación explícita de que solo pasajeros puedan crear reservas.

**Solución**: Agregar validación en `src/app/rides/[id]/page.tsx`:
```typescript
// En handleBooking(), antes de crear la reserva:
const { data: profile } = await supabase
  .from('profiles')
  .select('role')
  .eq('id', user.id)
  .single();

if (!profile || profile.role !== 'passenger') {
  alert('Solo los pasajeros pueden reservar asientos');
  return;
}
```

### 4. Verificar que la migración se ejecutó
**Problema**: Si la migración `004_blablacar_model.sql` no se ejecutó completamente, faltarán tablas/columnas.

**Solución**: 
- Ir a `/test-migration` y verificar que todas las verificaciones pasen
- Si hay errores, ejecutar la migración nuevamente en Supabase SQL Editor

## ⚠️ IMPORTANTE - Mejoras de seguridad

### 5. Validación de asientos disponibles
**Problema**: No se valida que haya suficientes asientos antes de crear la reserva.

**Solución**: Agregar validación en `handleBooking()`:
```typescript
// Verificar asientos disponibles antes de reservar
if (ride.available_seats < bookingSeats) {
  alert(`Solo hay ${ride.available_seats} asiento(s) disponible(s)`);
  return;
}
```

### 6. Validación de fecha/hora futura
**Problema**: No se valida que la fecha de salida sea futura al publicar viaje.

**Solución**: Agregar en `handleSubmit()` de `/publish`:
```typescript
const departureDateTime = new Date(`${departureDate}T${departureTime}`);
if (departureDateTime <= new Date()) {
  alert('La fecha y hora de salida deben ser futuras');
  return;
}
```

### 7. Prevenir reservas duplicadas
**Problema**: Un pasajero podría intentar reservar el mismo viaje dos veces.

**Solución**: Ya existe `UNIQUE(ride_id, passenger_id)` en la tabla `bookings`, pero agregar manejo de error:
```typescript
if (error?.code === '23505') { // Unique violation
  alert('Ya tienes una reserva para este viaje');
  return;
}
```

## 📋 OPCIONAL - Para mejorar la experiencia

### 8. Búsqueda con geolocalización
- Actualmente la búsqueda es por texto simple
- Mejorar para usar coordenadas y calcular distancias reales

### 9. Notificaciones
- Notificar a choferes cuando hay nuevas reservas
- Notificar a pasajeros cuando su reserva es confirmada/rechazada

### 10. Validación de precio mínimo/máximo
- Prevenir precios irracionales (muy bajos o muy altos)

### 11. Límite de reservas por pasajero
- Prevenir que un pasajero reserve más asientos de los disponibles

### 12. Manejo de errores mejorado
- Reemplazar `alert()` por componentes de notificación más elegantes
- Mensajes de error más descriptivos

## ✅ Lo que YA está implementado

- ✅ Base de datos con todas las tablas necesarias
- ✅ Triggers automáticos para actualizar asientos disponibles
- ✅ Triggers automáticos para actualizar ratings
- ✅ Páginas principales (homepage, búsqueda, publicar, detalles, mis viajes, mis reservas)
- ✅ Sistema de autenticación
- ✅ Creación automática de perfiles
- ✅ UI/UX tipo BlaBlaCar
- ✅ Sistema de colores verde
- ✅ Políticas RLS para bookings, reviews, messages

## 🚀 Pasos para hacerlo funcional

1. **Ejecutar migración** (si no se hizo): `004_blablacar_model.sql` en Supabase
2. **Agregar políticas RLS faltantes** para `rides` (ver punto 1)
3. **Agregar validación de rol** en `/publish` (ver punto 2)
4. **Agregar validación de rol** para reservas (ver punto 3)
5. **Probar el flujo completo**:
   - Crear cuenta como chofer
   - Publicar un viaje
   - Crear cuenta como pasajero
   - Buscar el viaje
   - Reservar asiento
   - Como chofer, aceptar la reserva

## 📝 Notas

- Las políticas RLS son **críticas** - sin ellas, el sistema no funcionará
- Las validaciones de rol son importantes para seguridad y UX
- Los triggers ya están implementados y funcionarán automáticamente
