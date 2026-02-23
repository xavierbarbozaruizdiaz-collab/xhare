# Runbook: RCA y corrección — "column base_route_polyline does not exist"

**Rol:** Senior Backend Engineer + DBA + SRE  
**Error:** `column base_route_polyline does not exist` al publicar en `/publish`  
**Contexto:** Next.js App Router, Supabase client-side insert, migración 008.

---

## A) REPRODUCCIÓN EXACTA

### Archivo y líneas exactas del insert

| Dato | Valor |
|------|--------|
| **Archivo** | `src/app/publish/page.tsx` |
| **Insert principal** | Líneas **215-218** |
| **Fallback (insert sin columnas)** | Líneas **223-226** |
| **Captura del error y alert** | Líneas **261-277** (bloque `catch`) |

Fragmento literal (líneas 215-218):

```ts
let { data, error } = await supabase
  .from('rides')
  .insert({ ...ridePayload, base_route_polyline: baseRoute, max_deviation_km: 1.0 })
  .select()
  .single();
```

- **`baseRoute`:** resultado de `getRoutePolyline(origin, destination, waypoints)` (líneas 186-191). Tipo: `Point[]` (array de `{ lat, lng }`) o `null` si falla la llamada OSRM.
- **`ridePayload`:** definido líneas 195-212; no incluye `base_route_polyline` ni `max_deviation_km`.

### Estructura real del payload enviado

**Primer intento (el que falla si falta la columna):**

```ts
{
  ...ridePayload,           // ver abajo
  base_route_polyline: baseRoute,  // Point[] | null
  max_deviation_km: 1.0
}
```

**`ridePayload` (líneas 195-212):**

```ts
{
  driver_id: user.id,           // UUID
  origin_lat: number,
  origin_lng: number,
  origin_label: string | undefined,
  destination_lat: number,
  destination_lng: number,
  destination_label: string | undefined,
  departure_time: string,        // ISO
  price_per_seat: number,
  available_seats: number,
  capacity: number,
  description: string | null,
  vehicle_info: { model?, year? } | null,
  flexible_departure: boolean,
  departure_flexibility: 'strict_5' | 'flexible_30',
  status: 'published',
  mode: 'free',
}
```

### Request HTTP real que falla

| Campo | Valor |
|-------|--------|
| **Método** | `POST` |
| **URL** | `https://<NEXT_PUBLIC_SUPABASE_URL>/rest/v1/rides` |
| **Headers** | `apikey: <NEXT_PUBLIC_SUPABASE_ANON_KEY>`, `Authorization: Bearer <session JWT>`, `Content-Type: application/json`, `Prefer: return=representation` |
| **Body** | JSON del objeto anterior (spread de ridePayload + base_route_polyline + max_deviation_km) |

Ejemplo de URL real (según `.env.local`):  
`https://ycjhcmpsbjqfurbmaqrt.supabase.co/rest/v1/rides`

### Código de error esperado de PostgREST

- **HTTP status:** `400 Bad Request`.
- **Body típico:** Objeto con `message` y `code`. Ejemplo: `"column \"base_route_polyline\" of relation \"rides\" does not exist"`.
- **Código PostgreSQL subyacente:** `42703` (undefined_column). PostgREST puede devolver también `code: "PGRST301"` en algunos casos de esquema/caché.
- El cliente Supabase JS expone esto en `error.message` (y a veces `error.code`), que es lo que se usa en el `catch` (líneas 262-264).

### Dónde se captura y se muestra el alert

- **Captura:** `src/app/publish/page.tsx` líneas **261-277** (bloque `catch` de `handleSubmit`).
- **Condición para el alert específico de base_route_polyline (línea 264):**  
  `msgStr.includes('base_route_polyline') || msgStr.includes('schema cache') || (error?.code === 'PGRST301')`
- **Mensaje mostrado (líneas 267-273):**  
  *"Falta actualizar la base de datos: la columna base_route_polyline no existe en la tabla rides."* + URL de Supabase (`process.env.NEXT_PUBLIC_SUPABASE_URL`) + instrucciones para ejecutar `008_ensure_base_route_polyline.sql`.*

---

## B) ANÁLISIS DE CÓDIGO

### Todas las referencias a base_route_polyline, max_deviation_km, is_base_stop

| Archivo | Líneas | Campo | Uso |
|---------|--------|--------|-----|
| `src/app/publish/page.tsx` | 186-191 | — | Obtiene `baseRoute` vía `getRoutePolyline()` (no escribe aún). |
| `src/app/publish/page.tsx` | 217 | base_route_polyline, max_deviation_km | **Escritura:** se envían en el INSERT a `rides`. |
| `src/app/publish/page.tsx` | 221, 264, 269-271 | base_route_polyline | Comentario y mensaje de error / alert. |
| `src/app/publish/page.tsx` | 244-246, 249-251 | is_base_stop | **Escritura:** se envía en INSERT a `ride_stops`; fallback sin este campo si falla. |
| `src/lib/routing/route-validator.ts` | 19-33 | — | `validateRouteDeviation(passengerPoint, baseRoute, maxDeviationKm)`: usa polyline en memoria (no lee de DB). |
| `src/lib/routing/route-validator.ts` | 39-74 | — | `getRoutePolyline()`: devuelve `Point[]` para enviar como `base_route_polyline`. |
| `supabase/migrations/006_add_route_validation.sql` | 5-7, 23 | base_route_polyline, max_deviation_km | ALTER TABLE rides, índice GIN. |
| `supabase/migrations/006_add_route_validation.sql` | 10-11, 26 | is_base_stop | ALTER TABLE ride_stops, índice. |
| `supabase/migrations/008_ensure_base_route_polyline.sql` | 5-7, 14, 16 | base_route_polyline, max_deviation_km | ALTER TABLE rides, índice, COMMENT. |
| `supabase/migrations/008_ensure_base_route_polyline.sql` | 10-11, 18 | is_base_stop | ALTER TABLE ride_stops, COMMENT. |
| `supabase/migrations/008_ensure_base_route_polyline.sql` | 20-37 | — | RLS en ride_stops (INSERT/UPDATE para drivers). |

No hay **lectura** de `base_route_polyline` ni `max_deviation_km` desde la base en el código actual (ningún `select` que las use). Las consultas usan `select('*')` o `select('*, ...')`; si la columna no existe, PostgREST no la devuelve y no falla el SELECT. El fallo es solo en el **INSERT** cuando el payload incluye la clave.

### Entidad afectada y propósito funcional

- **Entidad:** tabla **`rides`** (viajes modo "free"). No es la tabla `routes` (Ruta Fija con `polyline` en 001).
- **Propósito de base_route_polyline:**
  - **Al publicar:** persistir la geometría de la ruta (origen → waypoints → destino) obtenida con OSRM (`getRoutePolyline` en `src/lib/routing/route-validator.ts`).
  - **Uso funcional previsto:** validación de desvío para pasajeros (`validateRouteDeviation`): comprobar que un punto de recogida esté dentro de `max_deviation_km` de la ruta base. Esa función recibe el polyline en memoria; hoy no hay flujo que lea `base_route_polyline` desde la DB, pero el diseño es para matching/validación.
- **max_deviation_km:** límite en km para ese desvío; se guarda en `rides` y se usa por defecto 1.0 en código.
- **is_base_stop:** en `ride_stops`; marca origen/destino (true en primera y última parada). Usado para lógica de paradas base.

### Inconsistencias con src/types/index.ts

| Tipo | Archivo | Inconsistencia |
|------|---------|----------------|
| **Ride** | `src/types/index.ts` líneas 87-110 | No declara `base_route_polyline` ni `max_deviation_km`. El payload real los envía; el tipo está desactualizado. |
| **RideStop** | `src/types/index.ts` líneas 112-121 | No declara `is_base_stop`. El insert en publish (líneas 244-246) sí lo envía. |

No hay esquemas Zod en el repo que validen el row de `rides` o `ride_stops`.

---

## C) ANÁLISIS DE BASE DE DATOS

### Resumen de 006 y 008

**006_add_route_validation.sql:**

| Acción | Detalle |
|--------|---------|
| ALTER rides | `base_route_polyline jsonb`, `max_deviation_km numeric(5,2) DEFAULT 1.0` (IF NOT EXISTS). |
| ALTER ride_stops | `is_base_stop boolean DEFAULT false` (IF NOT EXISTS). |
| ALTER bookings | pickup_lat/lng/label, dropoff_lat/lng/label (IF NOT EXISTS). |
| Índice | `idx_rides_base_route` GIN en `rides(base_route_polyline)` sin filtro. |
| Índice | `idx_ride_stops_base` en `ride_stops(ride_id, is_base_stop)`. |

**008_ensure_base_route_polyline.sql:**

| Acción | Detalle |
|--------|---------|
| ALTER rides | `base_route_polyline jsonb`, `max_deviation_km numeric(4,2) DEFAULT 1.0` (IF NOT EXISTS). |
| ALTER ride_stops | `is_base_stop boolean DEFAULT false` (IF NOT EXISTS). |
| Índice | `idx_rides_base_route` GIN en `rides(base_route_polyline) WHERE base_route_polyline IS NOT NULL` (IF NOT EXISTS). |
| COMMENT | En rides.base_route_polyline, rides.max_deviation_km, ride_stops.is_base_stop. |
| RLS ride_stops | DROP + CREATE "Drivers can insert stops for their rides" (INSERT). |
| RLS ride_stops | DROP + CREATE "Drivers can update stops for their rides" (UPDATE). |

**¿Es 008 suficiente por sí sola?**

- **Sí.** 008 es idempotente (ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE POLICY). Añade las columnas necesarias para que el insert de publish no falle y las políticas RLS para que el insert en `ride_stops` (tras crear el viaje) esté permitido para conductores. No depende de 006; si 006 ya se aplicó, 008 no rompe nada.

### Queries SQL exactas de verificación

**1) Existencia de columnas en `rides`:**

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'rides'
  AND column_name IN ('base_route_polyline', 'max_deviation_km')
ORDER BY column_name;
```

Esperado si está corregido: 2 filas. Si 0 filas → migración no aplicada o proyecto equivocado.

**2) Existencia de columnas en `ride_stops`:**

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'ride_stops'
  AND column_name = 'is_base_stop';
```

Esperado: 1 fila.

**3) Índice GIN en `rides`:**

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'rides'
  AND indexname = 'idx_rides_base_route';
```

Esperado: 1 fila con `USING gin`.

**4) Políticas RLS en `ride_stops` (INSERT/UPDATE para drivers):**

```sql
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'ride_stops'
  AND policyname IN ('Drivers can insert stops for their rides', 'Drivers can update stops for their rides');
```

Esperado: 2 filas (INSERT y UPDATE).

### Riesgo de aplicar 008 en producción

- **Bajo.** Razones:
  - Solo añade columnas con `IF NOT EXISTS` y DEFAULT o nullable; no modifica datos existentes.
  - Índices con `IF NOT EXISTS`; comentarios y RLS con DROP IF EXISTS + CREATE.
  - No elimina columnas ni cambia tipos.
- **Precaución:** Si 006 ya creó `idx_rides_base_route` sin el filtro `WHERE base_route_polyline IS NOT NULL`, 008 hará `CREATE INDEX IF NOT EXISTS` y no creará un segundo índice con el mismo nombre; no hay conflicto. Si nunca se aplicó 006, 008 deja el esquema listo para publish y ride_stops.

---

## D) CAUSA RAÍZ (RCA)

### Hipótesis evaluadas con evidencia

**1) Migración no aplicada en el proyecto actual**

- **Evidencia:** El error indica que la columna no existe. La app usa `NEXT_PUBLIC_SUPABASE_URL` (ej. `ycjhcmpsbjqfurbmaqrt.supabase.co`). Si en ese proyecto no se ejecutó 006 ni 008, `rides` no tiene `base_route_polyline`.
- **Conclusión:** **Muy probable.** Es la explicación directa del mensaje de Postgres.

**2) Proyecto Supabase incorrecto (env mismatch)**

- **Evidencia:** El alert muestra la URL de `process.env.NEXT_PUBLIC_SUPABASE_URL`. Si en build/runtime se usa otra URL (otro .env o variable en hosting), el proyecto donde se aplicó la migración podría ser distinto al que usa la app.
- **Conclusión:** Posible si hay varios entornos o .env. Comprobar que la URL del alert coincida con la del proyecto donde se ejecutó 008.

**3) Drift manual del esquema**

- **Evidencia:** No hay scripts en el repo que borren la columna. Solo migraciones que la añaden.
- **Conclusión:** Poco probable salvo cambios manuales en la DB.

**4) Caché PostgREST**

- **Evidencia:** PostgREST puede cachear el esquema unos minutos. Tras aplicar la migración, la columna existe en Postgres pero PostgREST podría seguir rechazando el insert hasta refrescar.
- **Conclusión:** Puede retrasar la solución 1–2 minutos; no explica que la columna "no exista" de forma persistente. Si la query a `information_schema` muestra la columna y la app sigue fallando, entonces es candidato a caché (reinicio o espera).

**5) Conflicto 006 vs 008**

- **Evidencia:** Ambas usan `ADD COLUMN IF NOT EXISTS` y `CREATE INDEX IF NOT EXISTS`. 008 añade RLS en ride_stops que 006 no toca. No hay DROP COLUMN ni cambios incompatibles.
- **Conclusión:** No hay conflicto. Aplicar 008 después de 006 es seguro; aplicar solo 008 también es suficiente.

### Causa raíz elegida y justificación

**Causa más probable: (1) La migración que añade `base_route_polyline` (006 o 008) no se ha aplicado en el proyecto Supabase al que apunta `NEXT_PUBLIC_SUPABASE_URL`.**

Justificación: El mensaje de error es explícito (“column does not exist”). Eso solo ocurre cuando Postgres no tiene la columna. Las demás hipótesis no eliminan esa condición (env mismatch implica “migración en otro proyecto”; caché es transitoria). La acción correctiva es aplicar 008 en el proyecto correcto y verificar con las queries de la sección C.

---

## E) PLAN DE CORRECCIÓN SAFE

### Orden y pasos exactos

**Paso 1 — Confirmar proyecto y variables**

- Revisar `.env.local` (o las variables del entorno donde corre la app).
- Anotar `NEXT_PUBLIC_SUPABASE_URL` (ej. `https://ycjhcmpsbjqfurbmaqrt.supabase.co`).
- **Verificación:** En app.supabase.com, confirmar que el proyecto tiene esa URL. No cambiar código.

**Paso 2 — Verificar estado actual del esquema**

- En ese proyecto: SQL Editor → ejecutar las 4 queries de la sección C (columnas en rides, columnas en ride_stops, índice GIN, políticas RLS en ride_stops).
- **Verificación:** Si en `rides` no aparecen `base_route_polyline` y `max_deviation_km`, seguir. Si ya aparecen y la app sigue fallando, considerar caché (paso 4b).

**Paso 3 — Aplicar 008**

- En el **mismo** proyecto: SQL Editor → New query.
- Copiar **todo** el contenido de `supabase/migrations/008_ensure_base_route_polyline.sql`.
- Ejecutar.
- **Verificación:** Mensaje de éxito (sin errores). Si falla por “policy already exists” u otro, 008 ya está pensado con DROP IF EXISTS; si algo falla, anotar el error exacto.

**Paso 4 — Verificar esquema tras 008**

- Ejecutar de nuevo las 4 queries de la sección C.
- **Verificación:** 2 columnas en `rides`, 1 en `ride_stops`, índice `idx_rides_base_route`, 2 políticas en `ride_stops`.

**Paso 4b — Si la columna ya existía pero la app fallaba**

- Esperar 1–2 minutos (caché PostgREST) o reiniciar el servidor Next.js.
- Repetir prueba de publish.

**Paso 5 — Validación E2E**

- Usuario con rol `driver` en `profiles`.
- Ir a `/publish`, completar origen, destino, fecha/hora, precio, asientos.
- Enviar formulario.
- **Verificación:** No aparece el alert de “columna base_route_polyline no existe”. Mensaje de éxito y redirección a `/rides/:id`. En la base: 1 fila nueva en `rides` (con `base_route_polyline` y `max_deviation_km` si el primer insert tuvo éxito) y varias filas en `ride_stops` para ese `ride_id`.

**Paso 6 — No romper ride_stops ni RLS**

- 008 añade las políticas "Drivers can insert stops for their rides" y "Drivers can update stops for their rides". Sin ellas, el insert a `ride_stops` tras crear el viaje puede fallar por RLS.
- **Verificación:** Tras publicar, comprobar en Table Editor que el viaje creado tiene filas en `ride_stops`. No tocar políticas existentes de 001 (SELECT para drivers, FOR ALL para admins); 008 solo añade INSERT/UPDATE para drivers.

### Qué NO tocar

- **No modificar** la lógica de fallback en `src/app/publish/page.tsx` (líneas 221-229, 248-256): es correcta y permite seguir publicando si en algún entorno faltara la columna.
- **No eliminar** el manejo del error ni el alert (líneas 264-274): siguen siendo útiles para diagnóstico.
- **No tocar** `src/lib/routing/route-validator.ts` ni `getRoutePolyline`/`validateRouteDeviation`.
- **No ejecutar** DROP COLUMN ni cambios destructivos en migraciones ya aplicadas.

---

## F) PREVENCIÓN FUTURA

### 1) Script de verificación de esquema al iniciar (opcional)

Crear un script (por ejemplo `scripts/check-schema.sql` o ejecutable desde CI) que ejecute las 4 queries de la sección C y falle si falta alguna columna o política. Ejemplo de uso: antes de deploy o en un job que use `psql`/Supabase CLI contra el proyecto remoto.

```sql
-- check-schema.sql: fallar si falta algo crítico
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rides' AND column_name = 'base_route_polyline'
  ) THEN
    RAISE EXCEPTION 'Missing column rides.base_route_polyline. Run 008_ensure_base_route_polyline.sql';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ride_stops'
      AND policyname = 'Drivers can insert stops for their rides'
  ) THEN
    RAISE EXCEPTION 'Missing RLS policy on ride_stops for driver insert. Run 008.';
  END IF;
END $$;
```

### 2) Healthcheck SQL

Para un endpoint de health (p. ej. `/api/health` o interno): opcionalmente una ruta que, con service role o desde el backend, ejecute un `SELECT 1` o una query ligera a `rides` (por ejemplo `select id from rides limit 1`) para comprobar conectividad. No exponer comprobaciones de esquema detalladas en un endpoint público.

### 3) Mejora de tipos TypeScript

En `src/types/index.ts`:

- **Ride:** añadir `base_route_polyline?: unknown` (o `Point[] | null`) y `max_deviation_km?: number`.
- **RideStop:** añadir `is_base_stop?: boolean`.

Así el tipo refleja el esquema real y se evitan confusiones al usar estos campos más adelante (p. ej. al leer un ride y pasar `base_route_polyline` a `validateRouteDeviation`). No cambia el comportamiento en runtime.

### 4) Estrategia de control de migraciones

- Mantener un único historial de migraciones (por ejemplo en `supabase/migrations/` con orden 001, 002, … 008).
- Documentar en README o en este runbook que, para el proyecto en producción/staging, las migraciones se aplican desde el SQL Editor (o con `supabase db push` si se usa CLI) y que 008 es requisito para publicar viajes.
- Para nuevos entornos: aplicar migraciones en orden (001 → 008) o al menos 001, 004, 005, 007, 008 para el flujo de publish y ride_stops. No saltar 008 si se usa `/publish`.

---

**Documento:** `DB_SCHEMA_RCA_RUNBOOK.md`  
**Uso:** Seguir sección E para corregir; usar sección F para prevenir recurrencia. No modificar código salvo tipos (F.3) y scripts opcionales (F.1, F.2).
