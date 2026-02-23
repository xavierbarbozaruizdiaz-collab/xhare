# Auditoría DBA + Backend: "column base_route_polyline does not exist"

**Objetivo:** Determinar si el proyecto Supabase conectado tiene el esquema desactualizado o si la app apunta al proyecto incorrecto.  
**Reglas:** Sin modificar código. Solo evidencia del repo y queries SQL. Entregable en Markdown listo para ejecutar.

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

La evidencia es solo el estado actual del esquema (2.1–2.4), no el orden histórico de ejecución.

### Si hay drift de esquema

- **Drift** = diferencias entre el esquema real de la DB y lo que las migraciones del repo definen.
- Si las columnas **no existen** en la DB pero sí están en 006/008, hay drift por **falta de aplicación** de esas migraciones (no por borrado posterior).
- Si en algún momento se ejecutó un `DROP COLUMN` manual o un script que eliminara esas columnas, también sería drift; en el repo **no hay** ningún script que haga DROP de estas columnas, así que la causa esperada es “nunca aplicadas”, no “aplicadas y luego eliminadas”.

---

## 4) Entregables

### Diagnóstico final (una sola causa principal)

**Causa principal:** En el proyecto Supabase cuya URL está en `NEXT_PUBLIC_SUPABASE_URL`, **no existen** las columnas `rides.base_route_polyline` y `rides.max_deviation_km` porque **no se ha ejecutado** en ese proyecto ninguna migración que las cree (006 o 008). Es decir: **esquema desactualizado en el proyecto correcto**, no “proyecto incorrecto” por env mismatch.

- Si la URL de la app y la del proyecto en el Dashboard coinciden, entonces no es problema de “apuntar al proyecto incorrecto”.
- Si coinciden y aun así se ve el error, la comprobación definitiva es la query 2.4 en **ese** proyecto: 0 filas para esas columnas confirma “esquema desactualizado”.

### Pasos exactos para corregirlo

1. Confirmar proyecto: en **app.supabase.com** abrir el proyecto cuya **Project URL** es exactamente la de `NEXT_PUBLIC_SUPABASE_URL` en `.env.local` (o en el entorno que use la app).
2. Ejecutar la query **2.4** en ese proyecto. Si el resultado no tiene las 3 filas (rides.base_route_polyline, rides.max_deviation_km, ride_stops.is_base_stop), seguir.
3. En el **mismo** proyecto: **SQL Editor → New query**. Copiar y pegar **todo** el contenido de `supabase/migrations/008_ensure_base_route_polyline.sql` del repo. Ejecutar.
4. Ver que la ejecución termine sin error.
5. Volver a ejecutar la query **2.4**. Debe devolver **3 filas**.
6. (Opcional) Esperar 1–2 minutos por si PostgREST actualiza caché de esquema.
7. En la app: ir a `/publish`, publicar un viaje de prueba. No debe aparecer el alert de “columna base_route_polyline no existe”.

### Confirmación de que no se romperán otras tablas ni RLS

- **008 solo:**
  - Añade columnas con `ADD COLUMN IF NOT EXISTS` (nullable o con default). No borra ni altera columnas existentes.
  - Crea índices con `CREATE INDEX IF NOT EXISTS`. No elimina índices.
  - Hace `DROP POLICY IF EXISTS` y luego `CREATE POLICY` solo para dos políticas en **`ride_stops`** (“Drivers can insert stops for their rides”, “Drivers can update stops for their rides”). No toca políticas de otras tablas.
- **Tablas:** Solo se modifican **`rides`** (columnas + índice) y **`ride_stops`** (columna + políticas). No se toca `profiles`, `bookings`, `routes`, `ride_requests`, etc.
- **RLS en otras tablas:** No se modifican. Las políticas de `rides` (005, etc.) no se tocan en 008. Solo se añaden políticas en `ride_stops` para que los conductores puedan insertar y actualizar paradas de sus viajes; las políticas existentes de `ride_stops` (SELECT para drivers, FOR ALL para admins en 001) no se eliminan por nombre en 008 (008 solo hace DROP de las dos que luego crea de nuevo).

**Conclusión:** Aplicar 008 en el proyecto correcto no rompe otras tablas ni otras políticas RLS; solo actualiza el esquema y las políticas necesarias para publicar viajes y paradas.

---

**Documento:** `DB_AUDIT_SUPABASE_SCHEMA.md`  
**Uso:** Ejecutar las queries de la sección 2 en el proyecto indicado por `NEXT_PUBLIC_SUPABASE_URL`, interpretar con la sección 3, y seguir la sección 4 para el diagnóstico y la corrección.
