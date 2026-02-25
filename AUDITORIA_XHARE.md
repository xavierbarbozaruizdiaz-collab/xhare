# Auditoría completa — Xhare (Next.js + Supabase)

Todo lo siguiente está respaldado por código y migraciones del repo. Referencias a archivos y líneas donde aplica.

---

## 1) Mapa de funcionalidades (feature map)

### Pantallas por rol

#### Pasajero (passenger)

| Ruta | Archivo | Qué hace | Endpoints | Tablas (lectura/escritura) |
|------|---------|----------|-----------|----------------------------|
| `/search` | `src/app/search/page.tsx` | Búsqueda de viajes por origen, destino, fecha, asientos; guardar solicitud si no hay viajes; enlace a reservar | `GET /api/geocode/search`, `rpc('get_ride_booked_seats')` | `rides`, `ride_stops`, `profiles`, `trip_requests` (insert) |
| `/rides/[id]` | `src/app/rides/[id]/page.tsx` | Detalle de viaje: ver ruta, reservas, en curso ver posición; conductor: iniciar, llegué, subió/no-show/bajó, finalizar, calificar | `POST /api/route/polyline`, `POST /api/rides/[id]/update-status`, `set-awaiting-confirmation`, `arrive`, `location`, `rate-driver`, `rate-passenger`, `rpc('get_ride_public_info')`, `rpc('get_ride_booked_seats')` | `rides`, `ride_stops`, `bookings`, `ride_boarding_events`, `driver_ratings`, `passenger_ratings`, `profiles` |
| `/rides/[id]/reservar` | `src/app/rides/[id]/reservar/page.tsx` | Reservar/editar reserva: puntos subida/bajada, asientos, precio por tramo, mapa | `POST /api/route/polyline`, `POST /api/route/segment-stats` | `rides`, `ride_stops`, `bookings` (insert/update), `trip_requests` |
| `/my-bookings` | `src/app/my-bookings/page.tsx` | Listar mis reservas; cancelar; enlace al viaje | — | `bookings`, `rides`, `profiles` |
| `/offer/busco` | `src/app/offer/busco/page.tsx` | Listar “Busco viaje” (passenger_ride_requests) abiertos | `rpc('expire_offer_flow_items')` | `passenger_ride_requests`, `profiles` |
| `/offer/busco/new` | `src/app/offer/busco/new/page.tsx` | Crear “Busco viaje” | `GET /api/geocode/search` | `passenger_ride_requests` (insert) |
| `/offer/busco/[id]` | `src/app/offer/busco/[id]/page.tsx` | Ver solicitud y ofertas de conductores; aceptar/rechazar; crear conversación | `rpc('create_ride_from_accepted_driver_offer')`, `rpc('get_or_create_conversation')` | `passenger_ride_requests`, `driver_offers`, `profiles` |
| `/offer/busco/offers` | `src/app/offer/busco/offers/page.tsx` | Mis ofertas recibidas (busco) | — | `passenger_ride_requests`, `driver_offers` |
| `/offer/tengo` | `src/app/offer/tengo/page.tsx` | Listar “Tengo lugar” (driver_ride_availability) abiertos | `rpc('expire_offer_flow_items')` | `driver_ride_availability`, `profiles` |
| `/offer/tengo/[id]` | `src/app/offer/tengo/[id]/page.tsx` | Ver disponibilidad y ofertas de pasajeros; aceptar/rechazar; crear ride+booking | `rpc('create_ride_from_accepted_passenger_offer')`, `rpc('get_or_create_conversation')` | `driver_ride_availability`, `passenger_offers`, `profiles` |
| `/offer/tengo/new` | `src/app/offer/tengo/new/page.tsx` | Crear “Tengo lugar” (conductor) | `GET /api/geocode/search` | `driver_ride_availability` (insert) |
| `/my-trip-requests` | `src/app/my-trip-requests/page.tsx` | Mis solicitudes de trayecto (trip_requests) | — | `trip_requests` |
| `/messages` | `src/app/messages/page.tsx` | Lista de conversaciones | `rpc('get_my_conversations')` | `conversations`, `conversation_participants`, `chat_messages`, `profiles` |
| `/messages/[id]` | `src/app/messages/[id]/page.tsx` | Chat con un usuario | — | `conversations`, `chat_messages` (insert), `conversation_participants` |
| `/app/requests` | `src/app/app/requests/page.tsx` | Crear/ver solicitudes (ride_requests) flujo legacy | `POST/GET /api/requests` | `ride_requests`, `profiles` |
| `/login` | `src/app/login/page.tsx` | Login; registro como conductor → ensure-driver-pending | `POST /api/auth/ensure-driver-pending` | `profiles` (vía API) |

#### Conductor (driver)

| Ruta | Archivo | Qué hace | Endpoints | Tablas |
|------|---------|----------|-----------|--------|
| `/publish` | `src/app/publish/page.tsx` | Publicar viaje: origen, destino, paradas, horario, asientos, polyline | `POST /api/route/polyline` | `profiles`, `rides` (insert), `ride_stops` (insert), `trip_requests` (update opcional) |
| `/my-rides` | `src/app/my-rides/page.tsx` | Mis viajes; asientos reservados e importe; enlace a detalle/editar | — | `rides`, `bookings`, `profiles` |
| `/rides/[id]` | (igual que pasajero) | Como conductor: iniciar, llegué, subió/no-show/bajó, continuar, finalizar, calificar pasajero | (ver arriba) | (ver arriba) |
| `/rides/[id]/edit` | `src/app/rides/[id]/edit/page.tsx` | Editar viaje propio | — | `rides`, `ride_stops` |
| `/my-rides/[id]/edit-route` | `src/app/my-rides/[id]/edit-route/page.tsx` | Editar ruta del viaje | — | `rides`, `ride_stops` |
| `/driver` | `src/app/driver/page.tsx` | Hub conductor | — | `profiles` |
| `/driver/setup` | `src/app/driver/setup/page.tsx` | Config vehículo (modelo, año, asientos, layout); solicitar ser conductor | `POST /api/auth/ensure-driver-pending` | `profiles` |
| `/driver/pending` | `src/app/driver/pending/page.tsx` | Espera de aprobación admin; instrucciones | `GET /api/settings/driver-pending-instructions` | `profiles`, `settings` (vía API) |
| `/driver/trip-requests` | `src/app/driver/trip-requests/page.tsx` | Solicitudes de trayecto pendientes para ofrecer viaje | — | `trip_requests`, `profiles` |
| `/offer/tengo/*` | (ver arriba) | Tengo lugar: crear, listar, aceptar ofertas | (ver arriba) | (ver arriba) |
| `/offer/busco/[id]` | (ver arriba) | Enviar oferta a “Busco viaje” | — | `driver_offers` (insert) |
| `GET /api/rides/mine` | (API) | Listado de viajes del conductor (legacy: ride_passengers) | — | `rides`, `ride_stops`, `ride_passengers`, `ride_requests` |

#### Admin

| Ruta | Archivo | Qué hace | Endpoints | Tablas |
|------|---------|----------|-----------|--------|
| `/admin` | `src/app/admin/page.tsx` | Dashboard resumen | — | `profiles`, `rides` |
| `/admin/rides` | `src/app/admin/rides/page.tsx` | Listar viajes; eliminar; asignar conductor | — | `rides` (select, delete), `profiles` |
| `/admin/drivers` | `src/app/admin/drivers/page.tsx` | Aprobar/rechazar conductores (driver_pending → driver/passenger) | — | `profiles` (update) |
| `/admin/passengers` | `src/app/admin/passengers/page.tsx` | Listar pasajeros | — | `profiles` |
| `/admin/users` | `src/app/admin/users/page.tsx` | Usuarios | — | `profiles` |
| `/admin/settings` | `src/app/admin/settings/page.tsx` | Config global (ej. instrucciones driver_pending) | — | `settings` (select, update) |
| — | API | Dashboard datos y asignar conductor | `GET /api/admin/dashboard`, `POST /api/admin/rides/[id]/assign-driver` | `ride_requests`, `rides`, `ride_passengers`, `profiles`, `rides`, `audit_events` |

#### Común / sin rol fijo

| Ruta | Archivo | Qué hace | Endpoints | Tablas |
|------|---------|----------|-----------|--------|
| `/` | `src/app/page.tsx` | Landing; redirige según rol | — | — |
| `/app` | `src/app/app/page.tsx` | App post-login | — | — |
| `/offer` | `src/app/offer/page.tsx` | Elegir Busco viaje / Tengo lugar | — | — |
| `/test-migration` | `src/app/test-migration/page.tsx` | Prueba migraciones | — | — |

### Componentes clave (`src/components`)

| Componente | Uso |
|-----------|-----|
| `RideRouteMap.tsx` | Mapa con ruta, paradas, conductor en vivo (en_route). |
| `PickupDropoffMap.tsx` | Mapa subida/bajada en reservar. |
| `MapComponent.tsx` | Mapa genérico (búsqueda, publicar). |
| `UserRoleBadge.tsx` | Badge de rol (passenger/driver/admin). |
| `SeatMap.tsx` | Selección de asientos en reserva. |
| `ActiveRideBar.tsx` | Barra de viaje activo. |
| `OfferAcceptedNotifier.tsx` | Notificación de oferta aceptada. |
| `RouteThumbnail.tsx` | Miniatura de ruta. |
| `ErrorBoundary.tsx` | Captura errores de React. |
| `PageLoading.tsx` | Estado de carga. |

### Librerías críticas

- **Next.js** (App Router), **Supabase** (`@supabase/supabase-js`), **Zod** (validación en APIs), **React** (hooks). Geocodificación/Nominatim vía APIs propias; rutas OSRM vía `/api/route/polyline` y `/api/route/segment-stats`.

---

## 2) API inventory

Todas las rutas en `src/app/api/**/route.ts` (20 archivos).

| # | Ruta | Método | Propósito | Auth | Validaciones | Tablas R/W | Códigos error | Riesgos |
|---|------|--------|-----------|------|--------------|------------|---------------|---------|
| 1 | `health` | GET | Health + DB ping | No | — | profiles (read 1) | 503 si falla DB | Ninguno |
| 2 | `route/polyline` | POST | Polyline + duración OSRM | No | origin/destination lat/lng; rate 40/min | — | 429, 400, 500 | Abuso mitigado por rate limit |
| 3 | `route/segment-stats` | POST | Distancia/duración origen→destino | No | origin/destination | — | 400, 500 | Ninguno |
| 4 | `geocode/reverse` | GET | Reverse geocode Nominatim | No | lat, lng query | — | 400, 5xx, 500 | Ninguno |
| 5 | `geocode/search` | GET | Geocode Nominatim | No | q (min 2 chars) | — | 400, 5xx, 500 | Ninguno |
| 6 | `auth/ensure-driver-pending` | POST | Poner perfil en driver_pending | Bearer/body token; getUser | access_token; opc. full_name, phone, etc. | profiles (insert/update) | 401, 500 | Cualquier usuario puede hacerse driver_pending |
| 7 | `settings/driver-pending-instructions` | GET | Instrucciones para conductores pendientes | No (service client) | — | settings (read) | 200 siempre (default JSON) | Expone texto; sin RLS (service) |
| 8 | `requests` | POST, GET | Crear/listar ride_requests (legacy) | getUser | POST: Zod; role passenger | ride_requests, audit_events / ride_requests | 401, 403, 400, 201, 500 | Ninguno |
| 9 | `requests/[id]/confirm` | POST | Confirmar ride_request (proposed→confirmed) | getUser | Ownership; status proposed | ride_requests, audit_events | 401, 404, 400, 500 | Ninguno |
| 10 | `matching/run` | POST | Ejecutar matching (admin) | getUser; role admin | — | ride_requests, profiles (lectura) | 401, 403, 400, 500 | Ninguno |
| 11 | `admin/dashboard` | GET | Stats y listas admin | getUser; role admin | — | ride_requests, rides, ride_passengers, profiles | 401, 403, 500 | Dashboard usa ride_passengers (legacy), no bookings |
| 12 | `admin/rides/[id]/assign-driver` | POST | Asignar conductor a viaje | getUser; role admin | Zod driver_id; driver existe y role=driver; **no comprueba existencia ni estado del ride** | rides, audit_events | 401, 403, 404, 400, 500 | **IDOR/estado: ride puede no existir o no ser asignable** |
| 13 | `rides/mine` | GET | Viajes del conductor | getUser; role driver | driver_id = user.id | rides, ride_stops, ride_passengers, ride_requests | 401, 403, 400, 500 | Ninguno; devuelve ride_passengers (legacy) |
| 14 | `rides/[id]/checkin` | POST | Check-in conductor (checked_in/no_show) | getUser | Zod request_id, status; ride driver_id = user | rides, ride_passengers, audit_events | 401, 404, 400, 500 | **Legacy:** ride_passengers; no verifica request_id en este ride |
| 15 | `rides/[id]/location` | POST | Enviar ubicación conductor (en_route) | getUser | Zod lat/lng; ride driver; status en_route; rate 1/15s por (user, ride) | rides | 401, 404, 429, 400, 500 | Ninguno |
| 16 | `rides/[id]/update-status` | POST | Cambiar status (building|ready|assigned|en_route|completed|cancelled) | getUser; role driver | Zod status; ride driver_id = user | rides | 401, 403, 404, 400, 500 | **Schema:** DB solo permite draft|published|booked|en_route|completed|cancelled (004) → 400 al usar building/ready/assigned |
| 17 | `rides/[id]/set-awaiting-confirmation` | POST | awaiting_stop_confirmation (en_route) | getUser | Zod awaiting; ride driver; en_route | rides | 401, 404, 400, 500 | Ninguno |
| 18 | `rides/[id]/arrive` | POST | Llegada a parada + eventos boarded/no_show/dropped_off | getUser | Zod stopOrder, passengers[]; ride driver; en_route; **no valida que cada p.id sea booking de este ride** | ride_stops, ride_boarding_events, rides | 401, 404, 400, 500 | Integridad: FK booking_id evita otros rides; podría marcar booking equivocado si mismo ride |
| 19 | `rides/[id]/rate-driver` | POST | Pasajero califica chofer (1–5) | getUser | Zod stars; booking no cancelado en ride; 1 por (ride, passenger) | rides, bookings, driver_ratings | 401, 404, 403, 409, 400, 500 | Ninguno |
| 20 | `rides/[id]/rate-passenger` | POST | Chofer califica pasajero (1–5) | getUser | Zod passengerId, stars; ride driver; booking + dropped_off | rides, bookings, ride_boarding_events, passenger_ratings | 401, 404, 403, 409, 400, 500 | Ninguno |

**Rate limit:** solo `route/polyline` (40/min) y `rides/[id]/location` (1/15s por user+ride). Resto de APIs públicas o sensibles sin rate limit explícito.

---

## 3) DB inventory (migraciones)

Fuente: `supabase/migrations/001_initial_schema.sql` … `033_ratings.sql`.

### Tablas y columnas relevantes

| Tabla | Origen | Columnas clave | Constraints / Enums |
|-------|--------|----------------|---------------------|
| **profiles** | 001, 002, 004, 011, 013, 016 | id, role (passenger\|driver\|admin\|driver_pending), full_name, phone, address, city, avatar_url, rating_*, vehicle_*, driver_approved_at (014), vehicle_seat_count, vehicle_seat_layout (011) | profiles_role_check (013) |
| **routes** | 001 | id, name, direction, polyline, active | — |
| **settings** | 001, 015 | key, value (jsonb), updated_at | — |
| **ride_requests** | 001 | passenger_id, pickup_*, dropoff_*, pax_count, window_*, status (draft\|submitted\|…\|expired), proposed_meeting_*, price_estimate | status enum 001 |
| **rides** | 001, 004, 006, 009, 011, 029, 032 | driver_id, mode (route_fixed\|free), status **(004: draft\|published\|booked\|en_route\|completed\|cancelled)**; origin_*, destination_*, price_per_seat, available_seats, total_seats (009), base_route_polyline (006), seat_layout (011); driver_lat, driver_lng, driver_location_updated_at (029); started_at, current_stop_index, awaiting_stop_confirmation (032) | rides_status_check 004 |
| **ride_stops** | 001, 006, 032 | ride_id, stop_order, lat, lng, label, eta, is_base_stop (006), arrived_at (032) | — |
| **ride_passengers** | 001 | ride_id, request_id, passenger_id, status (pending\|checked_in\|no_show\|cancelled) | UNIQUE(ride_id, request_id) — **legacy** |
| **bookings** | 004, 006, 011, 017, 031 | ride_id, passenger_id, seats_count, pickup_stop_id/dropoff_stop_id (004); pickup_lat/lng/label, dropoff_* (006); selected_seat_ids (011); status (pending\|confirmed\|cancelled\|completed), payment_status, price_paid | UNIQUE(ride_id, passenger_id) (031); seats 1–50 (017) |
| **reviews** | 004 | ride_id, booking_id, reviewer_id, reviewed_id, rating 1–5, comment | UNIQUE(ride_id, reviewer_id, reviewed_id) — **legacy** (no se usa; ratings en driver_ratings/passenger_ratings) |
| **messages** | 004 | ride_id, sender_id, receiver_id, content, read | — **legacy** (chat unificado en conversations/chat_messages) |
| **audit_events** | 001 | actor_id, entity_type, entity_id, event_type, payload | — |
| **trip_requests** | 020, 023 | user_id, origin_*, destination_*, requested_date, requested_time (023), seats, status (pending\|accepted\|expired\|cancelled), ride_id | — |
| **passenger_ride_requests** | 025 | user_id, origin_*, destination_*, requested_date, requested_time, seats, suggested_price_per_seat, status (open\|closed\|expired\|cancelled), accept_offers_until | — |
| **driver_offers** | 025, 031 | passenger_request_id, driver_id, proposed_price_per_seat, message, ride_id, status (pending\|accepted\|…) | UNIQUE(passenger_request_id, driver_id) |
| **driver_ride_availability** | 025 | driver_id, origin_*, destination_*, departure_time, available_seats, suggested_price_per_seat, status, accept_offers_until | — |
| **passenger_offers** | 025, 031 | availability_id, passenger_id, offered_price_per_seat, seats, message, ride_id, status | UNIQUE(availability_id, passenger_id) |
| **conversations** | 024 | id, context_type, context_id | — |
| **conversation_participants** | 024 | conversation_id, user_id, last_read_at | PK (conversation_id, user_id) |
| **chat_messages** | 024 | conversation_id, sender_id, body | — |
| **ride_boarding_events** | 032 | ride_id, booking_id, stop_index, event_type (boarded\|no_show\|dropped_off) | UNIQUE(ride_id, booking_id, stop_index, event_type) |
| **driver_ratings** | 033 | ride_id, driver_id, passenger_id, stars 1–5 | UNIQUE(ride_id, passenger_id) |
| **passenger_ratings** | 033 | ride_id, driver_id, passenger_id, stars 1–5 | UNIQUE(ride_id, passenger_id) |

### Legacy vs actual

- **Legacy (flujo admin/matching):** ride_requests, ride_passengers, status de rides “building|ready|assigned” en código (pero **004** solo permite draft|published|booked|en_route|completed|cancelled). Tablas ride_requests/ride_passengers usadas por `/api/requests`, `/api/rides/mine`, `/api/admin/dashboard`, `/api/rides/[id]/checkin`.
- **Actual (flujo BlaBlaCar + ofertas):** bookings, rides (draft→published→booked→en_route→completed), ride_stops, ride_boarding_events, driver_ratings, passenger_ratings, passenger_ride_requests, driver_offers, driver_ride_availability, passenger_offers, trip_requests, conversations/chat_messages.
- **reviews** y **messages** (004): definidos pero reemplazados por driver_ratings/passenger_ratings y por conversations/chat_messages.

### Fuentes de verdad

| Concepto | Fuente de verdad |
|----------|------------------|
| Reservas (flujo principal) | **bookings** (ride_id, passenger_id, status, pickup_*, dropoff_*, seats_count, price_paid). |
| Pasajeros en viaje (legacy) | **ride_passengers** (solo flujo admin/matching). |
| Check-in subida/bajada | **ride_boarding_events** (boarded, no_show, dropped_off por stop_index). |
| Tracking conductor | **rides.driver_lat**, **rides.driver_lng**, **rides.driver_location_updated_at**. |
| Mensajes | **conversations** + **conversation_participants** + **chat_messages**. |
| Ofertas Busco/Tengo | **passenger_ride_requests**, **driver_offers**, **driver_ride_availability**, **passenger_offers**; aceptación crea ride+booking vía `create_ride_from_accepted_driver_offer` / `create_ride_from_accepted_passenger_offer`. |
| Estado del viaje en curso | **rides**: status, started_at, current_stop_index, awaiting_stop_confirmation; **ride_stops.arrived_at**. |

---

## 4) RLS y políticas

Resumen por tabla crítica. RLS está habilitado en todas.

### rides

- **SELECT:** publicado O conductor del ride O admin O (en_route Y booking no cancelado del usuario) — 032.
- **INSERT:** conductor con role=driver — 005.
- **UPDATE/DELETE:** conductor propio; admin ALL — 005.

**Agujeros:** Un pasajero sin booking no ve rides que no sean published; en en_route solo ve si tiene booking (correcto).  
**Bloqueos:** Ninguno obvio para en_route con booking.

### ride_stops

- **SELECT:** ride publicado O conductor O admin O (en_route Y booking no cancelado) — 018 + 032.
- **INSERT/UPDATE:** conductores para sus rides (migración **008**: “Drivers can insert stops for their rides”, “Drivers can update stops for their rides”). **DELETE:** solo admin (001).

### bookings

- **SELECT:** propio passenger_id; conductor del ride; usuarios autenticados para rides publicados (019, para mostrar pickups/dropoffs en mapa).
- **INSERT:** passenger_id = auth.uid() — 004.
- **UPDATE:** conductor del ride; pasajero propio (cancelar) — 004.

**Agujeros:** Política “Users can view bookings for published rides” permite a cualquier autenticado ver reservas de un viaje publicado (solo para mostrar puntos en mapa; no exponen datos sensibles beyond coords/labels).  
**Bloqueos:** Ninguno crítico.

### profiles

- **SELECT:** propio; admin; desde 027 “Authenticated users can view all profiles” (TO authenticated, USING true).
- **UPDATE:** propio; admin (013 para aprobar conductores).

**Agujeros:** Cualquier autenticado ve todos los perfiles (nombre, avatar, rating, etc.) — asumido para listados.  
**Bloqueos:** Ninguno.

### ride_boarding_events

- **SELECT:** conductor del ride; pasajero si booking_id es su booking — 032.
- **INSERT/UPDATE/DELETE:** solo conductor del ride — 032.

**Agujeros:** El API arrive no valida en servidor que cada booking_id pertenezca al ride; RLS sí (solo el driver puede insertar y el ride es del driver). FK booking_id→bookings evita bookings de otros rides.  
**Bloqueos:** Ninguno.

### driver_ratings / passenger_ratings

- **driver_ratings INSERT:** pasajero con booking no cancelado en ese ride — 033. **SELECT:** pasajero los suyos; conductor los que lo califican.
- **passenger_ratings INSERT:** conductor del ride (dropped_off validado en API). **SELECT:** pasajero los recibidos; conductor los emitidos.

**Agujeros:** Ninguno.  
**Bloqueos:** Ninguno.

### ride_requests (legacy)

- **SELECT:** passenger_id = auth.uid(); admin. **INSERT/UPDATE:** pasajero propio; admin.

### trip_requests, passenger_ride_requests, driver_offers, driver_ride_availability, passenger_offers

- Políticas en 020, 025: dueño ve/modifica; conductores ven pendientes/open; aceptación con políticas de UPDATE según rol.

### conversations / conversation_participants / chat_messages

- 024: solo participantes ven y envían; creación vía `get_or_create_conversation` (SECURITY DEFINER).

---

## 5) Flujos end-to-end

### Pasajero: búsqueda → reservar → viaje en curso → calificar chofer

- **Precondiciones:** Usuario autenticado, role passenger (o sin restricción en search; reservar exige login).
- **Pantallas:** `/search` → `/rides/[id]/reservar` → `/rides/[id]` (y `/my-bookings`).
- **Endpoints:** `GET /api/geocode/search`, `rpc('get_ride_booked_seats')`, `POST /api/route/polyline`, `POST /api/route/segment-stats`; insert booking vía Supabase client; luego `get_ride_public_info`, `update-status` (no), `location` (solo lectura cada 15s), `rate-driver`.
- **DB:** bookings (insert en reservar); ride en published → en_route → completed; driver_ratings (insert tras completar).
- **Edge cases:** Recarga en en_route: página vuelve a cargar ride/bookings por RLS (en_route + booking) — OK. Pasajero sin booking intenta ver ride en_route: RLS no devuelve el ride — 404/empty. Doble clic en reservar: UNIQUE(ride_id, passenger_id) + UI deshabilita botón evita duplicados.

### Chofer: publicar → iniciar → llegado → subió/no-show → continuar → dropoff → finalizar → calificar pasajero

- **Precondiciones:** Usuario driver (approved).
- **Pantallas:** `/publish` → `/rides/[id]` (iniciar, “Llegué”, modal pasajeros, continuar, finalizar), luego modal calificar pasajero.
- **Endpoints:** `POST /api/route/polyline`, insert rides/ride_stops; `POST /api/rides/[id]/update-status` (en_route, completed), `set-awaiting-confirmation`, `arrive`, `rate-passenger`; ubicación cada 25s `POST /api/rides/[id]/location`.
- **DB:** rides (insert published); update status en_route (started_at, current_stop_index, awaiting); ride_stops.arrived_at; ride_boarding_events (boarded/no_show/dropped_off); rides status completed; passenger_ratings.
- **Edge cases:** Chofer pierde internet en en_route: ubicación no se envía; pasajeros siguen viendo última posición; al recuperar, puede seguir enviando location y marcar llegadas. Doble clic en “Iniciar viaje”: update-status idempotente. Race en asientos: trigger update_ride_available_seats y UNIQUE(ride_id, passenger_id) reducen riesgo; doble reserva mismo usuario rechazada por DB. Errores OSRM/Nominatim: publish y reservar usan polyline/segment-stats con catch; mensajes genéricos.

### Admin: aprobar chofer → métricas → settings

- **Precondiciones:** Usuario admin.
- **Pantallas:** `/admin/drivers` (aprobar/rechazar), `/admin` (métricas), `/admin/settings`.
- **Endpoints:** `GET /api/admin/dashboard`, `POST /api/admin/rides/[id]/assign-driver`; actualización de profiles y settings vía Supabase client.
- **DB:** profiles (role driver_pending → driver/passenger); settings; rides (assign driver_id, status 'assigned'); ride_requests, ride_passengers (dashboard).
- **Edge cases:** assign-driver no comprueba que el ride exista ni su estado → puede 200 con 0 rows o asignar a viaje en estado incorrecto.

---

## 6) Observabilidad y manejo de errores

- **Logging:** No hay logger centralizado; en APIs solo `catch` con `NextResponse.json(..., 500)`. No se registran errores a archivo o servicio externo.
- **Errores al usuario:** Mensajes en `NextResponse.json({ error: ... })`; en UI, `alert()` o estado `error` y texto en pantalla (ej. publish `formatSupabaseError`, reservar `setError`, admin rides `alert(...)`).
- **Try/catch:** APIs suelen tener try/catch; en páginas a veces solo `.catch(() => {})` (ej. rides/[id] envío de location) sin mensaje.
- **Rate limit:** Solo en `route/polyline` y `rides/[id]/location`. Sin rate limit en: login/ensure-driver-pending, geocode/search, requests, assign-driver, update-status, arrive, rate-driver, rate-passenger, matching/run.

---

## 7) Recomendaciones priorizadas

### TOP 10 bugs o riesgos (archivo/línea o migración)

1. **Inconsistencia status de rides (API vs DB)**  
   - `src/app/api/rides/[id]/update-status/route.ts`: body permite `building`, `ready`, `assigned`; migración **004** solo permite `draft`, `published`, `booked`, `en_route`, `completed`, `cancelled`.  
   - Riesgo: 400 en producción al iniciar/asignar si se usan esos valores.  
   - **Archivo:** `supabase/migrations/004_blablacar_model.sql` (rides_status_check) y `src/app/api/rides/[id]/update-status/route.ts` (schema Zod).

2. **assign-driver no valida ride ni estado**  
   - `src/app/api/admin/rides/[id]/assign-driver/route.ts`: no comprueba que el ride exista ni que esté en estado asignable; update por `rideId` puede ser 0 rows y devolver 200.  
   - Riesgo: IDOR/estado incorrecto.  
   - **Archivo:** `src/app/api/admin/rides/[id]/assign-driver/route.ts` (antes del update).

3. **Dashboard admin usa ride_passengers (legacy)**  
   - `src/app/api/admin/dashboard/route.ts`: usa `ride_passengers` para conteo y activeRides; el producto principal usa `bookings`.  
   - Riesgo: métricas incorrectas o vacías.  
   - **Archivo:** `src/app/api/admin/dashboard/route.ts` (líneas 36–37, 59–60).

4. **rides/mine devuelve ride_passengers (legacy)**  
   - `src/app/api/rides/mine/route.ts`: select incluye `ride_passengers`, no bookings.  
   - Riesgo: lista de “mis viajes” sin reservas reales del flujo BlaBlaCar.  
   - **Archivo:** `src/app/api/rides/mine/route.ts`.

5. **arrive: no validar que passenger ids sean bookings del ride**  
   - `src/app/api/rides/[id]/arrive/route.ts`: inserta eventos por `p.id` sin comprobar que cada uno sea booking de este ride.  
   - Riesgo: integridad (marcar booking equivocado); FK limita a bookings existentes.  
   - **Archivo:** `src/app/api/rides/[id]/arrive/route.ts` (bucle insert).

6. **checkin usa ride_passengers (legacy)**  
   - `src/app/api/rides/[id]/checkin/route.ts`: actualiza ride_passengers; flujo principal usa bookings y ride_boarding_events.  
   - Riesgo: flujo mixto o muerto.  
   - **Archivo:** `src/app/api/rides/[id]/checkin/route.ts`.

7. **settings/driver-pending-instructions sin auth**  
   - `src/app/api/settings/driver-pending-instructions/route.ts`: usa service client; cualquiera puede llamar GET.  
   - Riesgo: bajo (solo texto de instrucciones).  
   - **Archivo:** `src/app/api/settings/driver-pending-instructions/route.ts`.

8. **ensure-driver-pending: cualquier usuario puede hacerse driver_pending**  
   - Diseño conocido; no verifica rol previo.  
   - **Archivo:** `src/app/api/auth/ensure-driver-pending/route.ts`.

9. **Envío de ubicación sin feedback de error**  
    - `src/app/rides/[id]/page.tsx`: `fetch(...location).catch(() => {})` sin mensaje ni reintento.  
    - **Archivo:** `src/app/rides/[id]/page.tsx` (líneas 82–90).

### TOP 10 mejoras impacto alto / esfuerzo bajo

1. Unificar enum de status de rides: ampliar CHECK en DB a `building`, `ready`, `assigned` además de los actuales, **o** cambiar API/UI para usar solo draft/published/booked/en_route/completed/cancelled en todos los flujos.
2. En assign-driver: comprobar existencia del ride y (opcional) estado permitido antes del update; devolver 404 si no existe.
3. Añadir rate limit a `/api/auth/ensure-driver-pending` y a `/api/geocode/search` (por IP o usuario).
4. En arrive: validar que cada `p.id` esté en `bookings` con ride_id = rideId antes de insertar eventos.
5. Dashboard admin: usar `bookings` (y opcionalmente ride_passengers si se mantiene flujo legacy) para conteos y listados.
6. rides/mine: incluir bookings en lugar de (o además de) ride_passengers para coherencia con el resto del producto.
7. “Drivers can insert/update ride_stops for their rides” (WITH CHECK ride_id en rides y driver_id = auth.uid()).
7. Try/catch y mensaje claro (o toast) en el envío de ubicación del conductor; opcional reintento con backoff.
8. Respuesta consistente en settings/driver-pending-instructions (ej. 401 si no auth, o mantener público y documentar).
9. Logging mínimo en APIs: log de error (console.error o logger) en catch antes de devolver 500.
10. (La política RLS para que drivers inserten/actualicen ride_stops ya existe en migración 008; no hace falta añadirla.)

### Plan por fases

**Phase 1 (estabilidad y seguridad)**  
- [ ] Unificar status de rides (DB o API).  
- [ ] assign-driver: validar ride existe y estado.  
- [ ] arrive: validar booking_id pertenece al ride.  
- [ ] Rate limit ensure-driver-pending y geocode/search.  
- [ ] Pruebas: asignar conductor, iniciar viaje, llegar a parada, completar.

**Phase 2 (consistencia de datos y RLS)**  
- [ ] Dashboard admin basado en bookings; decidir si mantener ride_passengers para legacy.  
- [ ] rides/mine con bookings.  
- [ ] Pruebas: dashboard, listado conductor, publicar viaje (ride_stops ya permitido para drivers en 008).

**Phase 3 (observabilidad y UX)**  
- [ ] Logging en APIs (errores 500).  
- [ ] Manejo de errores en envío de ubicación (mensaje + opcional reintento).  
- [ ] Revisar auth de driver-pending-instructions y documentar.  
- [ ] Pruebas E2E: flujo pasajero completo, flujo conductor completo, recarga en en_route, sin conexión.

---

*Documento generado a partir del código y migraciones del repositorio Xhare. Referencias exactas por archivo y sección indicadas en cada punto.*
