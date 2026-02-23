# Informe técnico: desajuste de esquema `base_route_polyline` en `rides`

**Rol:** Auditor senior (backend, DB, Next.js, Supabase)  
**Objetivo:** Entender por qué aparece el error “column base_route_polyline does not exist” y definir el fix y el plan de verificación sin romper nada.

---

## A) Reproducibilidad

### Flujo exacto donde se dispara el error

| Paso | Ruta / contexto | Acción | Resultado |
|------|-----------------|--------|-----------|
| 1 | `http://localhost:3000/publish` | Usuario completa formulario y hace clic en **Publicar viaje** | — |
| 2 | Misma página (client-side) | `handleSubmit` → `supabase.from('rides').insert({ ...ridePayload, base_route_polyline: baseRoute, max_deviation_km: 1.0 })` | **Error** |

- **Route/Page:** `src/app/publish/page.tsx` (App Router, página `/publish`).
- **Acción:** Publicar viaje = **INSERT** en tabla `rides` con columnas `base_route_polyline` y `max_deviation_km`.
- **Request que falla:** Llamada directa al **Supabase client** desde el navegador (no hay API route intermedia):
  - `supabase.from('rides').insert(...).select().single()`
  - Destino: `POST https://<SUPABASE_PROJECT_REF>.supabase.co/rest/v1/rides` (PostgREST).
- **Stack trace:** El error lo devuelve Supabase/PostgREST. En el cliente se captura en el `catch` de `handleSubmit` (aprox. líneas 261–277 de `src/app/publish/page.tsx`). No hay stack en servidor Next.js porque la llamada es client-side.
- **Mensaje mostrado al usuario:** Alert: *"Falta actualizar la base de datos: la columna base_route_polyline no existe en la tabla rides."* + instrucciones y URL del proyecto (según `process.env.NEXT_PUBLIC_SUPABASE_URL`).

### Condiciones para reproducir

1. Usuario con sesión y rol `driver` en `profiles`.
2. Origen y destino elegidos en el mapa/autocompletado.
3. Fecha/hora, precio y asientos completos.
4. Proyecto Supabase conectado **sin** tener la columna `base_route_polyline` en `rides` (migración 006 o 008 no aplicada).

---

## B) Análisis de código (rutas/archivos exactos)

### Referencias a `base_route_polyline`

| Archivo | Línea(s) | Uso |
|---------|----------|-----|
| `src/app/publish/page.tsx` | 186–192, 217, 221 (comentario), 264, 269–271 | **Escritura:** se obtiene polyline con `getRoutePolyline()` y se envía en el INSERT. **Manejo de error:** si el mensaje incluye `base_route_polyline` (o `schema cache` o `PGRST301`), se muestra el alert con instrucciones. |
| `src/app/publish/page.tsx` | 222–229 | **Fallback:** si el primer INSERT falla, se reintenta `insert(ridePayload)` **sin** `base_route_polyline` ni `max_deviation_km`. |
| `supabase/migrations/006_add_route_validation.sql` | 6, 23 | Definición de columna e índice. |
| `supabase/migrations/008_ensure_base_route_polyline.sql` | 6, 14, 16 | Definición de columna, índice y comentario. |

No hay **lectura** explícita de `base_route_polyline` en el código de la app (ni en `search`, ni en `rides/[id]`, etc.). Las consultas usan `select('*')` o `select('*, ...')`; si la columna no existe, PostgREST simplemente no la devuelve y no falla el SELECT. El fallo es solo en el **INSERT** cuando el payload incluye esa clave.

### Otras columnas relacionadas

- **`max_deviation_km`:** mismo INSERT en `publish/page.tsx` (línea 217); misma migración 006/008. Mismo comportamiento de fallback (se omite en el segundo insert).
- **`is_base_stop`:** tabla `ride_stops`. Se envía en el INSERT de paradas tras crear el viaje (líneas 244–256). Hay fallback: si el error menciona `is_base_stop`, se reinserta sin ese campo.

### Entidad y propósito funcional

- **Entidad:** tabla **`rides`** (viajes “libres” tipo BlaBlaCar), no `routes` ni otra tabla.
- **`routes`** (tabla distinta en `001_initial_schema.sql`, líneas 34–41): tiene un campo `polyline jsonb` para “Ruta Fija”; no se usa en el flujo de publicar viaje libre.
- **Propósito de `base_route_polyline` en `rides`:**
  - **Al publicar:** guardar la geometría de la ruta (origen → waypoints → destino) obtenida vía OSRM (`getRoutePolyline` en `src/lib/routing/route-validator.ts`, líneas 39–74). Formato: array de puntos `{ lat, lng }` (JSON compatible con `jsonb`).
  - **Uso previsto (evidencia en código):** `validateRouteDeviation()` en `src/lib/routing/route-validator.ts` (líneas 19–33) valida si un punto de recogida está dentro del desvío permitido respecto a una “base route” (array de puntos). Esa función recibe el polyline en memoria; en el repo **no** hay ningún `select` que lea `base_route_polyline` de la DB para pasarlo a `validateRouteDeviation`, pero el diseño es coherente con matching/validación de desvío usando la ruta guardada.
- **Resumen:** La columna sirve para **persistir la ruta base del viaje** (mapa, distancia, y futura validación de desvío para pasajeros). Es opcional en runtime porque existe fallback de insert sin ella.

### Tipos TypeScript / Zod

- **`src/types/index.ts`:** La interfaz `Ride` (líneas 87–110) **no** declara `base_route_polyline` ni `max_deviation_km`. Hay un desfase entre esquema deseado y tipos.
- No hay esquema Zod en el repo que valide el payload de `rides` (ni que exija `base_route_polyline`).

---

## C) Análisis de base de datos / migraciones

### Archivo que introduce la columna

- **`supabase/migrations/008_ensure_base_route_polyline.sql`** (existente en el repo).
- **Equivalente parcial:** `006_add_route_validation.sql` también añade `base_route_polyline` y `max_deviation_km` a `rides`; 008 es idempotente (ADD COLUMN IF NOT EXISTS) y además define políticas RLS para `ride_stops`.

### Resumen exacto de cambios de 008

| Cambio | Detalle |
|--------|---------|
| **ALTER TABLE rides** | `ADD COLUMN IF NOT EXISTS base_route_polyline jsonb`, `ADD COLUMN IF NOT EXISTS max_deviation_km numeric(4,2) DEFAULT 1.0`. |
| **ALTER TABLE ride_stops** | `ADD COLUMN IF NOT EXISTS is_base_stop boolean DEFAULT false`. |
| **Índice** | `CREATE INDEX IF NOT EXISTS idx_rides_base_route ON rides USING gin (base_route_polyline) WHERE base_route_polyline IS NOT NULL`. |
| **Comentarios** | COMMENT en `rides.base_route_polyline`, `rides.max_deviation_km`, `ride_stops.is_base_stop`. |
| **RLS** | `DROP POLICY IF EXISTS` + `CREATE POLICY` para "Drivers can insert stops for their rides" y "Drivers can update stops for their rides" en `ride_stops`. |

Ningún DEFAULT NOT NULL en las columnas nuevas; no rompen INSERTs existentes.

### Migraciones posteriores que dependan de la columna

- No hay migraciones **009+** en el repo que referencien `base_route_polyline`.
- **006** ya define la misma columna; si 006 se aplicó antes, 008 solo asegura que exista (IF NOT EXISTS) y añade RLS de `ride_stops`.

### Query de verificación (proyecto conectado)

Ejecutar en el **SQL Editor** del proyecto Supabase que usa la app (misma URL que en el alert):

```sql
-- Verificar si la columna existe en rides
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'rides'
  AND column_name IN ('base_route_polyline', 'max_deviation_km');
```

- **0 filas:** la columna no existe → hay que aplicar 006 o 008.
- **2 filas:** columnas presentes; el error podría ser de otro proyecto (env) o caché PostgREST.

Comprobar columna con nombre parecido (por si hubiera typo o variante):

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'rides'
  AND column_name LIKE '%polyline%';
```

---

## D) Diagnóstico de causa raíz

### Hipótesis evaluadas

| # | Hipótesis | Evidencia | Conclusión |
|---|-----------|-----------|------------|
| 1 | La migración 006/008 **no se aplicó** en el proyecto actual | Alert indica “columna no existe”; proyecto conocido por `.env.local`: `NEXT_PUBLIC_SUPABASE_URL=https://ycjhcmpsbjqfurbmaqrt.supabase.co` (ref: `ycjhcmpsbjqfurbmaqrt`). Si en ese proyecto no se ejecutó 006 ni 008, la tabla `rides` no tiene la columna. | **Causa más probable.** |
| 2 | Migración aplicada en **otro proyecto** (env mismatch) | Misma URL en alert y en `.env.local`; el cliente usa `process.env.NEXT_PUBLIC_SUPABASE_URL` para el mensaje. Si hubiera otro .env o build con otra URL, podría haber dos proyectos. | Posible si hay varios .env o despliegues con distinta URL. |
| 3 | Drift de esquema (columnas borradas o renombradas a mano) | No hay scripts en el repo que borren la columna. | Poco probable salvo cambios manuales en la DB. |
| 4 | Código apunta a tabla equivocada | El insert es explícitamente `from('rides')`. | Descartado. |
| 5 | Caché / tipos desactualizados | PostgREST puede cachear el esquema unos minutos. Tipos TS no definen la columna pero no provocan el error de Postgres. | Caché podría retrasar la visibilidad de la columna tras aplicar la migración; no explica que “no exista”. |

### Conclusión de causa raíz

La causa raíz más plausible es **(1) que en el proyecto Supabase referenciado por `NEXT_PUBLIC_SUPABASE_URL` no se ha ejecutado ninguna migración que añada `base_route_polyline` (y `max_deviation_km`) a `rides`.**  
El código intenta insertar esas columnas; PostgREST/Postgres rechaza el INSERT y el cliente muestra el alert. El fallback (reintentar sin esas columnas) evita el bloqueo total pero no corrige el esquema.

---

## E) Plan de corrección “safe”

### Fix mínimo recomendado

1. **Aplicar la migración en el proyecto correcto**
   - Confirmar que `NEXT_PUBLIC_SUPABASE_URL` en `.env.local` (y en el entorno donde se ejecuta la app) es exactamente el proyecto donde quieres el esquema (ej. `https://ycjhcmpsbjqfurbmaqrt.supabase.co`).
   - En **app.supabase.com** → ese proyecto → **SQL Editor** → New query.
   - Copiar y ejecutar **todo** el contenido de `supabase/migrations/008_ensure_base_route_polyline.sql` (incluye columnas en `rides` y `ride_stops` + RLS necesario para publicar viajes).
   - Ver “Success” (o sin errores).

2. **No es necesario cambiar código** para que el error desaparezca: el INSERT ya envía `base_route_polyline` y `max_deviation_km`; con la columna existente, el primer insert tendrá éxito y no se usará el fallback. Opcionalmente, actualizar `src/types/index.ts` (interfaz `Ride`) para incluir `base_route_polyline?: unknown` y `max_deviation_km?: number` para alinear tipos con la DB.

### Checklist de verificación

- [ ] **SQL check:** En el mismo proyecto, ejecutar la query de `information_schema.columns` anterior; debe devolver 2 filas para `base_route_polyline` y `max_deviation_km`.
- [ ] **Publish E2E:** En la app (localhost o staging), ir a `/publish`, completar formulario y publicar; no debe aparecer el alert de “columna no existe” y debe mostrarse éxito y redirección a `/rides/:id`.
- [ ] **RLS:** Si antes fallaba el insert en `ride_stops`, 008 ya añade políticas para que conductores inserten/actualicen paradas; verificar que el viaje publicado tenga filas en `ride_stops` para ese `ride_id`.
- [ ] **Migraciones existentes:** 008 usa solo `ADD COLUMN IF NOT EXISTS` y `DROP POLICY IF EXISTS` + `CREATE POLICY`; no modifica datos ni elimina columnas; es seguro respecto a migraciones ya aplicadas (001–007).

---

## F) Entregables

### Documento

- **Informe:** Este archivo: `DB_SCHEMA_MISMATCH_REPORT.md`.

### Action Plan (pasos 1..N)

1. **Confirmar proyecto:** Revisar `.env.local` y asegurarse de que `NEXT_PUBLIC_SUPABASE_URL` es el proyecto donde quieres tener la columna (ej. `ycjhcmpsbjqfurbmaqrt`).
2. **Verificar estado actual:** En ese proyecto, SQL Editor → ejecutar la query de `information_schema.columns` para `rides` y `base_route_polyline` / `max_deviation_km`. Si no aparecen, seguir.
3. **Aplicar 008:** En el mismo proyecto, SQL Editor → pegar y ejecutar todo `supabase/migrations/008_ensure_base_route_polyline.sql` → comprobar que no hay errores.
4. **Esperar 1–2 minutos** (por si PostgREST actualiza caché de esquema).
5. **Repetir la query de verificación:** Debe listar las dos columnas en `rides`.
6. **Prueba E2E:** Publicar un viaje desde `/publish` y confirmar que no sale el alert y que el viaje y sus paradas se crean correctamente.
7. **(Opcional)** Actualizar `src/types/index.ts` (Ride y RideStop) con `base_route_polyline`, `max_deviation_km` e `is_base_stop` para mantener tipos alineados con la DB.

### Cambios de código (PR plan) – opcionales

| Archivo | Cambio | Motivo |
|---------|--------|--------|
| `src/types/index.ts` | Añadir a `Ride`: `base_route_polyline?: unknown; max_deviation_km?: number`. A `RideStop`: `is_base_stop?: boolean`. | Alinear tipos con el esquema real y evitar confusiones en futuros usos (p. ej. cuando se use `base_route_polyline` en matching). |
| Ningún otro | El flujo de publish y fallback ya está correcto; no es obligatorio tocar `publish/page.tsx` para resolver el error una vez aplicada 008. | — |

---

## Datos faltantes / cómo obtenerlos

- **Confirmar proyecto Supabase en uso:**  
  En la app en runtime, el alert muestra la URL; también se puede imprimir en consola: `console.log(process.env.NEXT_PUBLIC_SUPABASE_URL)` (solo en desarrollo; no exponer service role).
- **Ver errores exactos de PostgREST:**  
  En el navegador, pestaña Network → request a `rest/v1/rides` (method POST) → ver respuesta (body y status). Código 400 con mensaje tipo “column ... does not exist” confirma el diagnóstico.
- **Listar migraciones aplicadas en Supabase (si usan CLI):**  
  `supabase db remote commit` / historial en Dashboard → Database → Migrations (si está habilitado); o comparar con el resultado de la query a `information_schema.columns` para saber qué columnas tiene realmente `rides`.
