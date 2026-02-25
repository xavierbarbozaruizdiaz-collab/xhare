# Entregable — Unificación y mejora total Xhare

## Confirmación

- **npm run build:** exitoso.
- **UberPool:** flujo publicado → reservas → en_route → completado sin usar estados legacy.
- **InDriver:** flujo Busco/Tengo + ofertas sin cambios estructurales; métricas separadas en admin.
- **Admin:** métricas en dos secciones (UberPool e InDriver), sin ride_requests/ride_passengers en principales.
- **Viaje en curso:** arrive con validaciones; ubicación con indicador de fallo y aviso de conexión.
- **Calificaciones:** sin cambios de lógica; rate limit añadido.

---

## 1. Lista de archivos modificados

| Archivo | Cambios |
|---------|--------|
| `src/app/api/rides/[id]/update-status/route.ts` | Estados unificados (draft/published/booked/en_route/completed/cancelled); rate limit. |
| `src/app/api/admin/rides/[id]/assign-driver/route.ts` | Validar ride existe; solo status=published; no usar 'assigned'; 0 rows → 400. |
| `src/app/api/admin/dashboard/route.ts` | Reescrito: secciones UberPool e InDriver; métricas desde rides/bookings/ratings y passenger_ride_requests/driver_offers/passenger_offers. |
| `src/app/admin/page.tsx` | Consume `/api/admin/dashboard`; muestra UberPool e InDriver por separado. |
| `src/app/api/rides/[id]/arrive/route.ts` | Validar stopOrder existe; validar booking en ride; evitar evento duplicado; rate limit. |
| `src/app/api/rides/mine/route.ts` | Fuente principal: bookings (ya no ride_passengers). |
| `src/app/api/auth/ensure-driver-pending/route.ts` | Rate limit (10/min por cliente). |
| `src/app/api/geocode/search/route.ts` | Rate limit (60/min por cliente). |
| `src/app/api/rides/[id]/rate-driver/route.ts` | Rate limit (20/min por usuario). |
| `src/app/api/rides/[id]/rate-passenger/route.ts` | Rate limit (20/min por usuario). |
| `src/types/index.ts` | RideStatus sin building/ready/assigned. |
| `src/lib/matching/routeFixed.ts` | status 'building' → 'draft' (crear/buscar ride). |
| `src/app/rides/[id]/page.tsx` | Estado locationSendFailed y connectionLost; indicador visual; sin catch vacío en envío de ubicación. |

---

## 2. Cambios exactos por archivo

### `src/app/api/rides/[id]/update-status/route.ts`
- Zod: `status` solo `['draft','published','booked','en_route','completed','cancelled']`.
- Import y uso de `checkRateLimit`, `getClientId`; límite 30 req/min por cliente.
- Respuesta 429 si se excede.

### `src/app/api/admin/rides/[id]/assign-driver/route.ts`
- Antes del update: obtener ride por id; si no existe → 404.
- Si `ride.status` es `en_route`|`completed`|`cancelled` → 400 con mensaje.
- Solo permitir si `ride.status === 'published'`.
- Update: solo `driver_id` (no cambiar status a 'assigned'); `.eq('status','published')` y `.select('id').maybeSingle()` para comprobar filas afectadas.
- Si `!updated` → 400 "No se pudo actualizar el viaje".

### `src/app/api/admin/dashboard/route.ts`
- Reemplazo completo del payload.
- **uberpool:** totalViajesPublicados, viajesEnCurso, viajesCompletados, totalReservas, asientosOcupados, tasaCancelacion, ratingPromedioConductor, ratingPromedioPasajero, activeRides (rides en published/booked/en_route con driver).
- **indriver:** solicitudesCreadas, disponibilidadesCreadas, ofertasEnviadas, ofertasAceptadas, viajesCreadosDesdeOferta, precioPromedioOfertadoDriver, precioPromedioOfertadoPassenger.
- **profiles:** pendingDrivers, totalDrivers, totalPassengersProfile.
- No se usan ride_requests ni ride_passengers para métricas principales.

### `src/app/admin/page.tsx`
- Fetch a `/api/admin/dashboard` (credentials: include).
- Estados loading y error.
- Sección "UberPool" con las 8 métricas y lista de viajes activos.
- Sección "InDriver" con las 7 métricas.
- Accesos rápidos y tarjetas de perfiles sin cambios de enlaces.

### `src/app/api/rides/[id]/arrive/route.ts`
- Rate limit: 20 req/min por cliente.
- Validar que exista `ride_stops` con ese `ride_id` y `stop_order`; si no → 400.
- Cargar bookings del ride (no cancelados); para cada `p.id` en `passengers` comprobar que esté en ese conjunto; si no → 400.
- Si hay pasajeros, comprobar que no exista ya un evento para (ride_id, stop_index, booking_id) en `ride_boarding_events`; si existe → 400 "Ya hay un evento registrado...".
- Resto del flujo igual (update stop, insert events, update ride).

### `src/app/api/rides/mine/route.ts`
- Select de rides con `ride_stops(*)` y `bookings(id, passenger_id, seats_count, status, price_paid, pickup_label, dropoff_label)`.
- Eliminado `ride_passengers` y `ride_requests`.

### `src/app/api/auth/ensure-driver-pending/route.ts`
- Import `checkRateLimit`, `getClientId`.
- Al inicio del POST: 10 req/min por cliente; 429 si se excede.

### `src/app/api/geocode/search/route.ts`
- Import `checkRateLimit`, `getClientId`.
- Al inicio del GET: 60 req/min por cliente; 429 si se excede.

### `src/app/api/rides/[id]/rate-driver/route.ts`
- Import rate limit; 20 req/min por usuario; 429 si se excede.

### `src/app/api/rides/[id]/rate-passenger/route.ts`
- Import rate limit; 20 req/min por usuario; 429 si se excede.

### `src/types/index.ts`
- `RideStatus`: eliminados `'building' | 'ready' | 'assigned'`; solo draft, published, booked, en_route, completed, cancelled.

### `src/lib/matching/routeFixed.ts`
- Búsqueda de rides existentes: `.eq('status', 'draft')` en lugar de `'building'`.
- Inserción de nuevo ride: `status: 'draft'` en lugar de `'building'`.
- (ride_requests.status 'assigned' se mantiene; es enum de ride_requests, no de rides.)

### `src/app/rides/[id]/page.tsx`
- Estados: `locationSendFailed`, `connectionLost`.
- useEffect: listeners `online`/`offline` para actualizar `connectionLost`.
- En sendLocation: `.then(res => { if (res.ok) setLocationSendFailed(false); else setLocationSendFailed(true); })` y `.catch(() => setLocationSendFailed(true))`; callback de error de geolocation llama `setLocationSendFailed(true)`.
- Banner visible cuando conductor, en_route y (locationSendFailed o connectionLost): texto "Sin conexión..." o "No se pudo enviar la ubicación...".

---

## 3. No modificado (según prompt)

- Estructura de `bookings`.
- Sistema Busco/Tengo (tablas y flujos).
- Sistema de conversaciones.
- Sistema de ratings (solo se añadió rate limit en APIs).
- RLS existente.
- Tablas legacy (ride_requests, ride_passengers) no eliminadas; solo dejaron de usarse en métricas principales y en rides/mine.

---

## 4. Constraint DB

- No se modificó la constraint de `rides.status` en migraciones (ya coincide con draft|published|booked|en_route|completed|cancelled en 004).

---

## 5. Checklist de verificación

- [x] UberPool: publicar → reservar → iniciar → en_route → llegar → completar → calificar (estados unificados).
- [x] InDriver: busco/tengo → ofertas → aceptar → ride creado (sin cambios de flujo).
- [x] Admin: dashboard con dos secciones y métricas separadas.
- [x] Viaje en curso: arrive con validaciones; conductor con indicador de fallo de ubicación y aviso de conexión.
- [x] Calificaciones: rate-driver y rate-passenger con rate limit.
- [x] assign-driver: solo published; 404 si no existe; 400 si 0 rows.
- [x] npm run build exitoso.
