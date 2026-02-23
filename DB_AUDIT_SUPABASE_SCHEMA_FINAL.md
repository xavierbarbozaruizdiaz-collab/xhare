# Auditoría DBA + Backend: "column base_route_polyline does not exist" — VERSIÓN FINAL

**Objetivo:** Determinar si el proyecto Supabase conectado tiene el esquema desactualizado o si la app apunta al proyecto incorrecto.  
**Reglas:** Sin modificar código. Solo evidencia del repo, queries SQL ejecutables y verificaciones. Entregable en Markdown listo para ejecutar.

---

## Verificaciones mínimas obligatorias

Antes de concluir diagnóstico o aplicar correcciones, ejecutá estos checks en orden. Cualquier fallo indica dónde está el problema.

| # | Verificación | Cómo comprobarlo | Resultado esperado |
|---|--------------|------------------|--------------------|
| 1 | **Proyecto correcto** | Comparar `NEXT_PUBLIC_SUPABASE_URL` en `.env.local` (o entorno en uso) con **Project URL** en app.supabase.com → Settings → General. | Coincidencia exacta (misma URL). |
| 2 | **Tabla `rides` existe** | Ejecutar query **2.6** (más abajo). | Al menos 1 fila: `rides` en schema `public`. |
| 3 | **Columnas requeridas** | Ejecutar query **2.4** en el proyecto que usa la app. | 3 filas (base_route_polyline, max_deviation_km, is_base_stop). Si hay menos, el esquema está desactualizado. |
| 4 | **RLS habilitado** | Ejecutar query **2.7**. | 2 filas: `rides` y `ride_stops` con `relrowsecurity = true`. |
| 5 | **Políticas necesarias** | Ejecutar query **2.8**. | Para publicar: al menos "Drivers can create rides" en `rides` y "Drivers can insert stops for their rides" en `ride_stops`. |
| 6 | **Post-corrección** | Tras aplicar 008, volver a ejecutar **2.4** y **2.8**. | 2.4 → 3 filas. 2.8 → las dos políticas de ride_stops listadas. |

Si el check 1 falla → estás mirando o aplicando migraciones en un proyecto distinto al que usa la app.  
Si 2 falla → la base no tiene la tabla `rides` (proyecto muy distinto o migraciones base no aplicadas).  
Si 3 falla y 1 y 2 pasan → **esquema desactualizado** (falta 006/008).  
Si 4 o 5 fallan → además de columnas, puede faltar RLS o políticas (001, 005, 008).

---

## Qué puede salir mal (y cómo detectarlo)

| Problema | Síntoma | Cómo detectarlo |
|----------|--------|------------------|
| **Caché PostgREST** | La query **2.4** devuelve 3 filas pero la app sigue mostrando "column base_route_polyline does not exist". | PostgREST cachea el esquema unos minutos. **Detectar:** columnas existen en `information_schema` (2.4) pero el INSERT vía API sigue fallando. **Acción:** Esperar 1–2 minutos y reintentar; o en Dashboard → Settings → API → "Reload schema cache" si existe la opción; o reiniciar el servidor Next.js para forzar nuevas peticiones. |
| **RLS bloquea insert en ride_stops** | El viaje se crea en `rides` pero falla al insertar paradas (error de política o 403). | **Detectar:** En Network (DevTools), el POST a `/rest/v1/rides` devuelve 201 pero el POST a `/rest/v1/ride_stops` devuelve 403 o error de RLS. **Verificar:** Query **2.8** debe incluir la política "Drivers can insert stops for their rides" en `ride_stops`. Si no existe, aplicar 008. |
| **Proyecto equivocado** | Aplicaste 008 en otro proyecto y en el que usa la app sigue el error. | **Detectar:** La URL que muestra el alert de la app no es la del proyecto donde ejecutaste el SQL. **Verificar:** Check 1: misma URL en `.env.local` y en Dashboard del proyecto donde corriste las queries y 008. |

---

## 1) Proyecto que usa la app

### Dónde se define `NEXT_PUBLIC_SUPABASE_URL`

| Ubicación | Uso |
|-----------|-----|
| **`.env.local`** (raíz del repo) | Define el valor en runtime para Next.js. Es el archivo que carga las variables de entorno en desarrollo. |
| **`src/lib/supabase/client.ts`** líneas 3-4 | `const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;` — cliente browser. |
| **`src/lib/supabase/server.ts`** líneas 4-5 | `const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;` — cliente servidor. |
| **`src/app/publish/page.tsx`** líneas 265-266 | Se usa en el mensaje de error: `process.env.NEXT_PUBLIC_SUPABASE_URL` para mostrar la URL en el alert. |

No hay otros archivos en el repo (fuera de `node_modules` y `.next`) que definan o sobrescriban esta variable. En producción/otros entornos, el valor dependerá de las variables configuradas en ese entorno (Vercel, etc.), no del repo.

### Cómo confirmar que la URL coincide con el proyecto en Supabase

1. Abrí **`.env.local`** y anotá el valor de `NEXT_PUBLIC_SUPABASE_URL` (ej. `https://XXXXXXXX.supabase.co`).
2. Entrá a **https://app.supabase.com** → lista de proyectos.
3. Abrí el proyecto que querés que use la app y en **Settings → General** revisá **Reference ID** o la **Project URL**. La URL debe ser exactamente la de `NEXT_PUBLIC_SUPABASE_URL`.
4. **Comprobación adicional:** El JWT en `NEXT_PUBLIC_SUPABASE_ANON_KEY` incluye el claim `ref` con el mismo identificador del proyecto. Si tenés otro proyecto, ese `ref` será distinto.

**Conclusión:** La app usa el proyecto cuya URL está en `NEXT_PUBLIC_SUPABASE_URL`. Si el error aparece, ese proyecto es el que tiene (o no) la columna; no hay lógica en el código que elija otro proyecto.

---

## 2) Queries SQL para ejecutar en el proyecto actual

Ejecutá estas queries en **Supabase → SQL Editor** del proyecto cuya URL está en `NEXT_PUBLIC_SUPABASE_URL`.

### 2.1 ¿Existe `rides.base_route_polyline`?

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'rides'
  AND column_name = 'base_route_polyline';
```

- **0 filas** → la columna no existe (esquema desactualizado).
- **1 fila** → la columna existe (el error podría ser de caché o de otro flujo).

### 2.2 ¿Existe `rides.max_deviation_km`?

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'rides'
  AND column_name = 'max_deviation_km';
```

- **0 filas** → no existe.  
- **1 fila** → existe.

### 2.3 ¿Existe `ride_stops.is_base_stop`?

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'ride_stops'
  AND column_name = 'is_base_stop';
```

- **0 filas** → no existe.  
- **1 fila** → existe.

### 2.4 Resumen en una sola query (recomendado)

```sql
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'rides' AND column_name IN ('base_route_polyline', 'max_deviation_km'))
    OR (table_name = 'ride_stops' AND column_name = 'is_base_stop')
  )
ORDER BY table_name, column_name;
```

Interpretación:

- **0 filas** → ninguna de las tres columnas existe (006 y 008 no aplicadas).
- **1 o 2 filas** → solo parte aplicada (ej. rides sin columnas pero ride_stops con is_base_stop, o al revés).
- **3 filas** → las tres columnas existen; si la app sigue fallando, revisar caché PostgREST o que la app esté usando la misma URL.

### 2.5 Migraciones aplicadas (historial vía CLI)

Supabase puede registrar migraciones aplicadas por CLI en una tabla. Si solo usaste **SQL Editor** en el Dashboard, esta tabla puede estar vacía o no existir.

```sql
-- Intentar esquema típico de Supabase CLI
SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version;
```

Si falla con "relation does not exist":

```sql
-- Alternativa: esquema public (algunas instalaciones)
SELECT * FROM schema_migrations ORDER BY version;
```

Si ambas fallan, no hay tabla de migraciones en la DB (común cuando todo se aplicó desde SQL Editor). En ese caso el **único criterio fiable** es el resultado de las queries de `information_schema.columns` (2.1–2.4).

### 2.6 Existencia de la tabla `rides` y en qué schema(s) aparece

```sql
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_name = 'rides'
ORDER BY table_schema;
```

- **0 filas** → la tabla `rides` no existe en la base (proyecto muy distinto o no se aplicó 001).
- **1 o más filas** → cada fila indica un schema donde existe `rides`. La app y PostgREST usan por defecto el schema **public**; si solo aparece en `public`, es el esperado.

### 2.7 RLS habilitado en `rides` y `ride_stops`

```sql
SELECT n.nspname AS table_schema, c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('rides', 'ride_stops')
  AND c.relkind = 'r'
ORDER BY c.relname;
```

- **0 filas** → alguna tabla no existe en `public`.  
- **2 filas** → esperado: `rides` y `ride_stops` con `rls_enabled = true`. Si alguna tiene `false`, RLS no está habilitado (no coincide con el diseño del repo: 001 habilita RLS en ambas).

### 2.8 Políticas RLS relevantes (pg_policies)

Para publicar un viaje la app necesita: poder INSERT en `rides` (policy para drivers) y poder INSERT en `ride_stops` (policy para drivers). Esta query lista las políticas que afectan a esas tablas:

```sql
SELECT schemaname, tablename, policyname, cmd, permissive
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('rides', 'ride_stops')
ORDER BY tablename, policyname;
```

**Relevantes para el flujo de publish (según repo):**

- **rides:** al menos una política que permita **INSERT** para el driver (ej. "Drivers can create rides" en 005).
- **ride_stops:** al menos una política que permita **INSERT** para el conductor del viaje (ej. "Drivers can insert stops for their rides" en 008). Sin esta, el insert a `ride_stops` tras crear el viaje falla por RLS.

Si en `ride_stops` no aparece ninguna política con `cmd = 'INSERT'` (o un nombre como "Drivers can insert stops for their rides"), hay que aplicar 008.

---

## 3) Determinación

### Si falta aplicar 006 o 008

- **006** (`supabase/migrations/006_add_route_validation.sql`): añade `base_route_polyline`, `max_deviation_km` en `rides`, `is_base_stop` en `ride_stops`, índices y columnas en `bookings`.
- **008** (`supabase/migrations/008_ensure_base_route_polyline.sql`): añade las mismas columnas en `rides` y `ride_stops` (idempotente), más políticas RLS en `ride_stops` para que conductores puedan INSERT/UPDATE paradas.

**Criterio:**

- Si la query 2.4 devuelve **menos de 3 filas**, falta aplicar al menos una migración que cree esas columnas. **008 es suficiente por sí sola** (tiene `ADD COLUMN IF NOT EXISTS` y las políticas necesarias para publicar viajes). No es obligatorio aplicar 006 antes.

### Si el proyecto fue creado sin ejecutar todas las migraciones

- Si en la query 2.4 aparecen **0 filas** para esas tres columnas, el proyecto tiene un esquema que no incluye los cambios de 006/008. Eso puede ser porque:
  - Se creó el proyecto y solo se ejecutaron migraciones anteriores (001–005, 007) y nunca 006 ni 008, o
  - Se creó desde cero y se aplicaron solo algunas migraciones manualmente.

La evidencia es solo el estado actual del esquema (2.1–2.4 y 2.6), no el orden histórico de ejecución.

### Si hay drift de esquema

- **Drift** = diferencias entre el esquema real de la DB y lo que las migraciones del repo definen.
- Si las columnas **no existen** en la DB pero sí están en 006/008, hay drift por **falta de aplicación** de esas migraciones (no por borrado posterior).
- Si en algún momento se ejecutó un `DROP COLUMN` manual o un script que eliminara esas columnas, también sería drift; en el repo **no hay** ningún script que haga DROP de estas columnas, así que la causa esperada es "nunca aplicadas", no "aplicadas y luego eliminadas".

---

## 4) Entregables

### Diagnóstico final (una sola causa principal)

**Causa principal:** En el proyecto Supabase cuya URL está en `NEXT_PUBLIC_SUPABASE_URL`, **no existen** las columnas `rides.base_route_polyline` y `rides.max_deviation_km` porque **no se ha ejecutado** en ese proyecto ninguna migración que las cree (006 o 008). Es decir: **esquema desactualizado en el proyecto correcto**, no "proyecto incorrecto" por env mismatch.

- Si la URL de la app y la del proyecto en el Dashboard coinciden, entonces no es problema de "apuntar al proyecto incorrecto".
- Si coinciden y aun así se ve el error, la comprobación definitiva es la query 2.4 en **ese** proyecto: 0 filas para esas columnas confirma "esquema desactualizado".

### Pasos exactos para corregirlo

1. **Confirmar proyecto:** En **app.supabase.com** abrir el proyecto cuya **Project URL** es exactamente la de `NEXT_PUBLIC_SUPABASE_URL` en `.env.local` (o en el entorno que use la app). (Check 1.)
2. **Verificar estado:** Ejecutar en ese proyecto las queries **2.6**, **2.4**, **2.7** y **2.8**. Si 2.4 no devuelve 3 filas, seguir.
3. **Aplicar 008:** En el **mismo** proyecto: **SQL Editor → New query**. Copiar y pegar **todo** el contenido de `supabase/migrations/008_ensure_base_route_polyline.sql` del repo. Ejecutar.
4. **Comprobar éxito:** Ver que la ejecución termine sin error.
5. **Re-verificar:** Volver a ejecutar **2.4** y **2.8**. 2.4 debe devolver **3 filas**. 2.8 debe mostrar las políticas de ride_stops ("Drivers can insert stops for their rides", "Drivers can update stops for their rides"). (Check 6.)
6. **(Opcional)** Esperar 1–2 minutos por si PostgREST actualiza caché de esquema (ver sección "Qué puede salir mal").
7. **E2E:** En la app: ir a `/publish`, publicar un viaje de prueba. No debe aparecer el alert de "columna base_route_polyline no existe" y el viaje debe crearse con sus paradas.

### Confirmación de que no se romperán otras tablas ni RLS

- **008 solo:**
  - Añade columnas con `ADD COLUMN IF NOT EXISTS` (nullable o con default). No borra ni altera columnas existentes.
  - Crea índices con `CREATE INDEX IF NOT EXISTS`. No elimina índices.
  - Hace `DROP POLICY IF EXISTS` y luego `CREATE POLICY` solo para dos políticas en **`ride_stops`** ("Drivers can insert stops for their rides", "Drivers can update stops for their rides"). No toca políticas de otras tablas.
- **Tablas:** Solo se modifican **`rides`** (columnas + índice) y **`ride_stops`** (columna + políticas). No se toca `profiles`, `bookings`, `routes`, `ride_requests`, etc.
- **RLS en otras tablas:** No se modifican. Las políticas de `rides` (005, etc.) no se tocan en 008. Solo se añaden políticas en `ride_stops` para que los conductores puedan insertar y actualizar paradas de sus viajes; las políticas existentes de `ride_stops` (SELECT para drivers, FOR ALL para admins en 001) no se eliminan por nombre en 008 (008 solo hace DROP de las dos que luego crea de nuevo).

**Conclusión:** Aplicar 008 en el proyecto correcto no rompe otras tablas ni otras políticas RLS; solo actualiza el esquema y las políticas necesarias para publicar viajes y paradas.

---

**Documento:** `DB_AUDIT_SUPABASE_SCHEMA_FINAL.md`  
**Uso:** Seguir "Verificaciones mínimas obligatorias" y "Qué puede salir mal"; ejecutar las queries de la sección 2 en el proyecto indicado por `NEXT_PUBLIC_SUPABASE_URL`; interpretar con la sección 3; aplicar la sección 4 para el diagnóstico y la corrección.
