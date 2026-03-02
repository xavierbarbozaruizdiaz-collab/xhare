# Informe: Flujo de la app Xhare y error 42P17

**Modo solo lectura.** Sin cambios de código ni migraciones.

---

## A) Así funciona hoy

### 1. Roles y permisos

- **Quién es driver / pasajero / admin:** Lo define la tabla **`profiles`** (campo `role`: `'passenger' | 'driver' | 'admin'`).  
  `profiles.id` = `auth.users.id` (un perfil por usuario de Supabase Auth).
- **Dónde se guarda:** `profiles` (migración 001). Las funciones `is_admin(user_id)` e `is_driver(user_id)` leen esa tabla (SECURITY DEFINER) para RLS y API.

### 2. Flujo “Publicar viaje” (chofer)

- **Pantalla:** `src/app/publish/page.tsx`.
- **Acción:** El usuario (con `profiles.role = 'driver'`) completa origen, destino, fecha/hora, asientos, descripción, vehículo, etc., y envía el formulario.
- **Llamada:** Inserción directa con el cliente Supabase (RLS aplica):
  ```ts
  supabase.from('rides').insert(ridePayload).select().single()
  ```
- **Payload típico:** `driver_id: user.id`, `status: 'published'`, `origin_*`, `destination_*`, `departure_time`, `available_seats`, `total_seats`, `price_per_seat` (0 o valor), `vehicle_info`, `mode: 'free'`, etc.
- **Validaciones en app:** Solapamiento de horarios con otros viajes del mismo conductor (consulta previa a `rides` con `driver_id` y `status in ('published','booked','en_route','draft')`). Si falla el insert por columnas, reintento sin `departure_flexibility`. Luego se insertan `ride_stops` y opcionalmente se actualiza `base_route_polyline` en el mismo ride.

### 3. Flujo “Ver / Buscar viajes” (pasajero)

- **Pantalla:** `src/app/search/page.tsx`.
- **Query:**  
  `supabase.from('rides').select('*, driver:profiles!(...), ride_stops(*)').eq('status', 'published')`  
  más filtros por `departure_time` (fecha o ventana futura) y, si hay origen/destino, por rango de fechas. Límite 150, orden por `departure_time`.
- **Filtros:** `date`, `origin`, `destination`, `seats` (asientos disponibles). Opcionalmente proximidad (origen/destino) y precio máximo. Se usa RPC `get_ride_booked_seats` para asientos reservados y se filtra por asientos restantes ≥ `seats`.
- **Quién usa estos datos:** La página de búsqueda; los resultados enlazan a `/rides/[id]` o `/rides/[id]/reservar`.

### 4. Flujo “Reservar” (booking)

- **Pantallas:** Entrada desde búsqueda → `src/app/rides/[id]/reservar/page.tsx`.
- **Carga del ride:** `supabase.from('rides').select(...).eq('id', rideId).maybeSingle()` (RLS aplica). Se cargan también `ride_stops` y `bookings` del ride (no cancelados).
- **Creación de reserva:**  
  `supabase.from('bookings').insert({ ride_id, passenger_id: user.id, seats_count, price_paid, status: 'pending', payment_status: 'pending', pickup_*, dropoff_*, ... })`.
- **Estados de booking:** `pending`, `confirmed`, `cancelled`, `completed` (004). La app crea con `pending`; el conductor ve reservas en el detalle del viaje.
- **Relación:** `bookings.ride_id` → `rides.id`; `bookings.passenger_id` → `profiles.id`. Una reserva por pasajero por viaje (UNIQUE `ride_id`, `passenger_id`).

### 5. Flujo “Viaje en curso” (en_route)

- **Cuándo pasa a `en_route`:** El conductor, en `/rides/[id]`, toca **“Iniciar viaje”**. La app llama `POST /api/rides/[id]/update-status` con `{ status: 'en_route' }`. El API (con sesión de Supabase) comprueba que el usuario sea driver y dueño del ride y hace `supabase.from('rides').update({ status: 'en_route', started_at, current_stop_index, ... }).eq('id', rideId)`.
- **Pantalla que debe seguir viendo el ride en curso:**  
  **Pasajero:** `/rides/[id]` (detalle del viaje). Ahí ve mapa, paradas, y si el ride está `en_route` también la **ubicación del conductor** (`driver_lat`, `driver_lng`) que se actualiza por el endpoint de ubicación y se recarga cada 15 s.  
  Para poder ver la página, el pasajero debe **poder hacer SELECT del row de `rides`** (porque `loadRide()` hace `from('rides').select(...).eq('id', rideId)`).
- **Qué necesita el pasajero en `en_route`:** Ver el mismo ride (origen, destino, paradas, conductor), ver posición del conductor en tiempo casi real, y después del viaje poder calificar al conductor. No hay chat en el flujo principal; hay mensajes en otra tabla.

### 6. Tablas involucradas (resumen)

| Tabla              | Propietario / clave                          | Uso principal                                |
|--------------------|----------------------------------------------|---------------------------------------------|
| **profiles**       | `id` = auth.uid(); `role`                    | Rol (driver/passenger/admin), nombre, tel., vehículo |
| **rides**          | `driver_id` → profiles.id; `status`          | Viaje: estados draft → published → en_route → completed/cancelled |
| **ride_stops**     | `ride_id` → rides.id                        | Paradas del recorrido (orden, lat/lng, label) |
| **bookings**       | `ride_id`, `passenger_id`; `status`          | Reservas: pending/confirmed/cancelled/completed |
| **ride_boarding_events** | `ride_id`, `booking_id`              | Eventos “Subió / No subió / Bajó” por parada (en_route) |
| **driver_ratings / passenger_ratings** | ride_id, driver_id, passenger_id | Calificaciones post-viaje |
| **trip_requests**  | user_id, ride_id (si aceptada)               | Solicitudes de trayecto; si se aceptan, se vinculan al ride |

Estados de **rides** usados en la app: `draft`, `published`, `booked`, `en_route`, `completed`, `cancelled`.

---

## B) Qué se quería lograr (intención del producto)

- El **conductor** publica un viaje (origen, destino, fecha, asientos, precio) y lo ve en “Mis viajes”. Puede editar, iniciar viaje (`en_route`), marcar “Llegué” en paradas, confirmar pasajeros (subió/no subió/bajó), finalizar viaje y calificar pasajeros.
- El **pasajero** busca viajes publicados por fecha/origen/destino, ve detalle y hace una reserva (recogida/descenso, asientos, precio). Ve “Mis reservas” y el detalle del viaje (incluido cuando está `en_route`: mapa, paradas, ubicación del conductor en tiempo real). Al terminar, puede calificar al conductor.
- **Publicado (`published`):** Cualquiera autenticado puede ver el ride en búsqueda y en detalle; solo el conductor puede editarlo e iniciarlo.
- **En curso (`en_route`):** El conductor ve acciones “Llegué”, “Continuar”, “Finalizar” y comparte ubicación. El **pasajero con reserva activa** debe poder seguir viendo ese mismo ride (detalle y ubicación en vivo).
- **Completado / cancelado:** Solo lectura; conductor y pasajeros involucrados pueden ver y calificar según corresponda.
- Ninguna policy de `rides` debe leer de `rides` (ni vía subconsulta ni vía otra tabla cuya RLS lea `rides`) para evitar recursión 42P17.

---

## C) Dónde se rompe y por qué (42P17)

- **Qué query se ejecuta al publicar:**  
  En `publish/page.tsx`, tras armar `ridePayload`, se hace:
  ```ts
  await supabase.from('rides').insert(ridePayload).select().single()
  ```
  Es decir: **INSERT** en `rides` y acto seguido un **SELECT** del mismo row (para obtener `id` y mostrar “Viaje publicado” y enlace al detalle).

- **Qué policy se evalúa y por qué hay loop:**  
  Para el **INSERT** solo se evalúa la policy de INSERT (p. ej. “Drivers can create rides” con `WITH CHECK (driver_id = auth.uid() ...)`). Ahí no hay recursión.  
  El **SELECT** que devuelve el row recién insertado dispara la policy **“Anyone can view published rides”** (definida en 032) sobre `rides`:
  ```sql
  USING (
    status = 'published' OR driver_id = auth.uid() OR is_admin(auth.uid())
    OR ( status = 'en_route' AND EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.ride_id = rides.id AND b.passenger_id = auth.uid() AND b.status != 'cancelled'
    ))
  )
  ```
  Para evaluar el `EXISTS (SELECT 1 FROM bookings b WHERE ...)` Postgres aplica **RLS sobre `bookings`**. Una de las policies de `bookings` es “Drivers can view bookings for their rides”, que hace:
  ```sql
  EXISTS ( SELECT 1 FROM rides WHERE rides.id = bookings.ride_id AND rides.driver_id = auth.uid() )
  ```
  Ese **SELECT desde `bookings` hacia `rides`** hace que se vuelva a evaluar la policy SELECT de **rides** → que a su vez vuelve a evaluar el `EXISTS` sobre **bookings** → que otra vez consulta **rides** → **recursión infinita** y error **42P17** (“infinite recursion detected in policy for relation 'rides'”).

- **Punto exacto:** La policy SELECT de `rides` que incluye `EXISTS (SELECT ... FROM bookings ...)` (migración 032). El loop es:  
  **rides SELECT** → subquery **bookings** → RLS **bookings** → **rides** → repite.

---

## D) Opciones de solución (sin implementar aquí)

1. **Quitar de la policy de `rides` cualquier subquery que toque `bookings` (o cualquier tabla cuya RLS lea `rides`).**  
   Dejar SELECT de `rides` solo con condiciones sobre la fila actual: p. ej. `status = 'published' OR driver_id = auth.uid() OR is_admin(auth.uid())`.  
   **Consecuencia:** Un pasajero con reserva en un ride `en_route` ya no vería ese ride por RLS directo. Habría que darle acceso por otro medio (ver 2 o 3).

2. **Exponer el detalle “público” del ride (incl. en_route para pasajeros con reserva) por API que use service role o por función SECURITY DEFINER** que lea `rides`/`bookings` sin RLS y devuelva solo lo permitido. La pantalla `/rides/[id]` llamaría a esa API/función en lugar de (o además de) `from('rides').select(...)` con el usuario normal.

3. **Vista o función que devuelva filas de `rides` que el usuario puede ver**, definida con `SECURITY DEFINER` y lógica explícita (driver, admin, status published, o en_route + booking activo), y dar SELECT sobre esa vista/función en lugar de sobre `rides` directamente. Así las policies de `rides` no se usan para esa lectura y se evita el loop.

4. **Mantener la política de `rides` sin subquery a `bookings`** (como en 1) y que “Mis reservas” / “Detalle del viaje” para pasajeros en viajes `en_route` se apoyen en una ruta API (o RPC) que, con service role o SECURITY DEFINER, devuelva el ride cuando el usuario tenga un booking no cancelado en ese ride. La UI ya no dependería de que el SELECT a `rides` con RLS devuelva la fila para ese pasajero en `en_route`.

5. **Revisar policies de `bookings`** para que “Drivers can view bookings for their rides” no use un `SELECT` directo a `rides` (por ejemplo, usar una función SECURITY DEFINER que, dado `ride_id` y `auth.uid()`, devuelva si el usuario es el conductor). Así se rompe el ciclo rides → bookings → rides. Sigue siendo necesario que la policy de `rides` no haga SELECT a `bookings` (o el ciclo podría reproducirse en otro orden).

La opción ya aplicada en el proyecto (migración 034) es de tipo **1**: políticas de `rides` sin subconsultas a `bookings` ni a `rides`. Si se quiere que el pasajero siga viendo el viaje en curso en `/rides/[id]`, hay que complementar con alguna de las opciones **2**, **3** o **4**.

---

## E) Por qué salía "Algo salió mal" al ver un viaje (/rides/[id])

**Causa raíz:** Una excepción en tiempo de ejecución durante el render (o en un `useEffect` del árbol de componentes) que el **ErrorBoundary** del layout captura y muestra como "Algo salió mal. Recargá la página o volvé más tarde." con botón "Reintentar".

**Dónde falla exactamente:** En el componente **`RideRouteMap`** (`src/components/RideRouteMap.tsx`). Ahí se dibujan los marcadores de paradas con Leaflet:

```ts
L.marker([stop.lat, stop.lng], { icon }).addTo(mapRef.current!);
```

Si alguna parada tiene **`lat` o `lng` en `null` o `undefined`**, Leaflet recibe coordenadas inválidas y **lanza una excepción**. Esa excepción no está capturada dentro del componente, así que sube al ErrorBoundary y se muestra la pantalla de error.

**Por qué aparecen paradas con coordenadas nulas:**

1. El viaje se carga por el **RPC `get_ride_detail_for_user`** cuando el usuario es conductor, admin o tiene reserva (porque el SELECT directo a `rides` con RLS no devuelve fila en esos casos).
2. La RPC devuelve **`ride_stops`** tal cual de la base: `jsonb_agg(jsonb_build_object('lat', rs.lat, 'lng', rs.lng, ...))`. Si en la tabla **`ride_stops`** alguna fila tiene **`lat` o `lng` en NULL** (o el ride tiene paradas sin coordenadas), esos valores llegan al front como `null`/`undefined`.
3. La página construía la lista **`stops`** mapeando **todas** las paradas de `ride.ride_stops` **sin filtrar** las que no tienen `lat`/`lng` válidos.
4. Esa lista se pasaba a **`RideRouteMap`**, que hacía `L.marker([stop.lat, stop.lng], ...)` para cada parada → **fallo en la primera parada con coordenadas nulas**.

**Resumen:** El "por qué" es: **paradas con `lat`/`lng` nulos en la base (o en la respuesta del RPC) llegaban al mapa sin filtrar; Leaflet lanza al crear un marcador con coordenadas inválidas; el ErrorBoundary muestra "Algo salió mal."**

**Correcciones aplicadas:** (1) En la página del viaje, al construir `stops` desde `ride_stops`, filtrar por `lat != null && lng != null` y usar `stop_order ?? 0`. (2) En `RideRouteMap`, filtrar `sortedStops` por coordenadas válidas y finitas y usar `stop_order ?? 0` en el orden. (3) Opcional: tratar la respuesta del RPC por si Supabase la devuelve en array; try/catch al construir `data` desde el RPC para no propagar errores inesperados.
