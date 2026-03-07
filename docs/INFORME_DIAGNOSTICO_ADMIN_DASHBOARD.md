# Informe diagnóstico: métricas del panel admin que no cargan

## A) Archivo exacto donde se carga el dashboard

- **Mensaje de error:** `src/app/admin/page.tsx` (líneas 105–127). El texto "No se pudieron cargar las métricas del inicio. Usá el menú para ir a Conductores, Billing, etc." se muestra cuando `isAdmin && (error || !data)`.
- **Hook que carga las métricas:** `useEffect` en el mismo archivo (líneas 41–74). Hace un único `GET /api/admin/dashboard` con el token del contexto `useAdminAuth()`.
- **Endpoint que resuelve las métricas:** `src/app/api/admin/dashboard/route.ts` — función `GET(request)`.

El cliente **no** llama a Supabase ni a RPC directamente; toda la carga pasa por esa API route.

---

## B) Lista de métricas que el dashboard intenta cargar

Todas vienen del **mismo endpoint** `GET /api/admin/dashboard`. Dentro del API se usan **Supabase con service role** (sin RPC ni Edge Functions). Por métrica:

| # | Nombre interno (log) | Tabla / origen | Columnas usadas | Uso |
|---|----------------------|----------------|-----------------|-----|
| 1 | `rides_published` | `rides` | `id`, count, `status = 'published'` | totalViajesPublicados |
| 2 | `rides_en_route` | `rides` | `id`, count, `status = 'en_route'` | viajesEnCurso |
| 3 | `rides_completed` | `rides` | `id`, count, `status = 'completed'` | viajesCompletados |
| 4 | `rides_all` | `rides` | `id`, `status` | Filtro viajes activos + activeRides |
| 5 | `bookings` | `bookings` | `id`, `status`, `seats_count` | totalReservas, asientosOcupados, tasaCancelación |
| 6 | `driver_ratings` | `driver_ratings` | `stars` | ratingPromedioConductor |
| 7 | `passenger_ratings` | `passenger_ratings` | `stars` | ratingPromedioPasajero |
| 8 | `active_rides_with_driver` | `rides` + `profiles` (FK `rides_driver_id_fkey`) | `*`, `driver(id, full_name)` | Lista viajes activos con conductor |
| 9 | `passenger_ride_requests` | `passenger_ride_requests` | `id`, `status` | solicitudesCreadas (InDriver) |
| 10 | `driver_ride_availability` | `driver_ride_availability` | `id`, `status` | disponibilidadesCreadas |
| 11 | `driver_offers` | `driver_offers` | `id`, `status`, `ride_id`, `proposed_price_per_seat` | ofertas, precios (InDriver) |
| 12 | `passenger_offers` | `passenger_offers` | `id`, `status`, `ride_id`, `offered_price_per_seat` | ofertas, precios (InDriver) |
| 13 | `profiles_by_role` | `profiles` | `role` | pendingDrivers, totalDrivers, totalPassengersProfile |

Todas son **consultas directas** con `createServiceClient()` (service role), sin RLS en la práctica.

---

## C) Cuál falla exactamente

**Aún no se puede afirmar** sin ejecutar en desarrollo.

- Si el fallo es **401**: no llega token válido o la sesión no es admin; entonces **ninguna métrica se evalúa** (el API responde 401 antes de las queries).
- Si el fallo es **500**: alguna de las 13 consultas (o el procesado posterior) lanza en el servidor.

Para saber **qué métrica** provoca el 500:

1. Ejecutar la app en **development** (`npm run dev`).
2. Entrar a `/admin` como usuario admin.
3. Revisar:
   - **Consola del servidor** (terminal donde corre `next dev`): logs `[ADMIN_METRIC_START]`, `[ADMIN_METRIC_OK]` y `[ADMIN_METRIC_ERROR] <nombre> <error>`.
   - **UI**: si la respuesta es 500, debajo del mensaje genérico aparece en rojo `[dev] Métrica que falló: <nombre>` (y opcionalmente detalle).

La última métrica que aparezca como `[ADMIN_METRIC_START]` sin un `[ADMIN_METRIC_OK]` correspondiente, o la que figure en `[ADMIN_METRIC_ERROR]`, es la que falla.

---

## D) Motivos técnicos posibles (por tipo de fallo)

- **401 Unauthorized**  
  - Token no enviado, expirado o inválido.  
  - `getUser(jwt)` o `getUser()` falla.  
  - Variable de entorno (Supabase URL/anon key o JWT secret) incorrecta en el servidor.

- **403 Forbidden**  
  - El usuario no tiene `profiles.role = 'admin'`.

- **500 por tabla/columna inexistente**  
  - Migraciones no aplicadas en la DB que usa el API (p. ej. `driver_ratings`, `passenger_ratings`, tablas InDriver).  
  - Nombre de tabla o columna distinto al esperado en el código.

- **500 por RLS**  
  - Poco probable porque el dashboard usa **service role** (`createServiceClient()`), que ignora RLS.

- **500 por FK o join**  
  - `active_rides_with_driver` usa `profiles!rides_driver_id_fkey`. Si la FK no existe o el nombre cambió, esa consulta puede fallar.

- **500 por null/undefined en el servidor**  
  - Acceso a propiedad de un objeto que viene null (p. ej. `ridesPublished.count`); el código ya usa `?? 0` o similar en la mayoría de los casos.

- **Variable de entorno faltante**  
  - `SUPABASE_SERVICE_ROLE_KEY` (o la que use `createServiceClient`) no definida en el entorno donde corre el API → fallo al crear el cliente o al ejecutar queries.

---

## E) Fix mínimo recomendado

1. **Si en dev ves 401**  
   - Revisar que el cliente envíe `Authorization: Bearer <token>` y/o `x-admin-token` en la petición a `/api/admin/dashboard`.  
   - Asegurar que el token sea el de sesión actual (p. ej. tras `refreshSession()` al cargar `/admin`).  
   - Comprobar en Vercel/local que las env de Supabase (URL, keys) sean las correctas.

2. **Si en dev ves 500 y el log/UI indica la métrica**  
   - **Tabla/columna inexistente:** aplicar migraciones que definan esa tabla/columna en la base usada por el API.  
   - **FK/join (p. ej. `active_rides_with_driver`):** comprobar que exista `rides_driver_id_fkey` y que el nombre en el `select` coincida.  
   - **Variable de entorno:** definir `SUPABASE_SERVICE_ROLE_KEY` (o la equivalente) en el entorno del API.

3. **No hacer refactor amplio** hasta tener el resultado del paso “C” (métrica concreta que falla).

---

## F) Si el resto de métricas funcionan o no

- **Si la respuesta es 401 o 403:** el API no llega a ejecutar ninguna query; **ninguna métrica se carga**.
- **Si la respuesta es 500:** el API lanza en la primera consulta (o paso) que falle. Las métricas **posteriores a esa** no se ejecutan; las **anteriores** ya se habrán ejecutado correctamente (en dev se ve por `[ADMIN_METRIC_OK]`).  
  Por tanto: o todas se cargan (200), o una falla y el cliente recibe 500 y no muestra ninguna métrica (el dashboard no hace “parcial” por métrica).

---

## Instrumentación añadida (solo development)

- En **`src/app/api/admin/dashboard/route.ts`**:  
  - En dev, las 13 métricas se ejecutan **en secuencia** con logs `[ADMIN_METRIC_START]`, `[ADMIN_METRIC_OK]` y `[ADMIN_METRIC_ERROR]`.  
  - En respuestas 500 en dev se incluye en el body `failedMetric` y opcionalmente `detail`.

- En **`src/app/admin/page.tsx`**:  
  - En dev, si la respuesta es 5xx se parsea el body y se muestra debajo del mensaje genérico: `[dev] Métrica que falló: <nombre>` (y detalle si viene).

Para diagnóstico: ejecutar `npm run dev`, reproducir el fallo en `/admin` y usar consola del servidor + mensaje `[dev]` en la UI para identificar la métrica exacta y aplicar el fix mínimo (E).
