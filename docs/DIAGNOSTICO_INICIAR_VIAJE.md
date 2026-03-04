# Diagnóstico: "No se pudo iniciar viaje"

## Objetivo

Identificar si el fallo al pulsar **Iniciar Viaje** es por **Autenticación** (JWT), **Autorización** (RLS) o **Payload** (ride_id/status), y aplicar la solución en los archivos involucrados.

---

## 1. Frontend — `src/app/rides/[id]/page.tsx`

### Headers y body enviados a la Edge Function

- **URL:** `process.env.NEXT_PUBLIC_SUPABASE_URL + '/functions/v1/ride-update-status'`
- **Método:** `POST`
- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer ${token}` — el `token` es `session?.access_token` de Supabase Auth (obtenido con `getSession()` y, si hace falta, `refreshSession()`).
- **Body:** `JSON.stringify({ ride_id: rideId, status: newStatus })`  
  - `rideId` = `params.id` (string UUID de la ruta).  
  - `newStatus` = `'en_route'` para Iniciar viaje.

**Conclusión:** El frontend envía correctamente el JWT en `Authorization: Bearer <token>` y el payload `{ ride_id, status }`. No hay discrepancia de nombres (se usa `ride_id`, no `id`).

---

## 2. Backend — Edge Function `ride-update-status/index.ts`

### Cómo valida al usuario

- **Cliente Supabase:** `createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } })`.  
  Usa la **anon key** y el **header del usuario** (JWT), no Service Role. Así las peticiones a la DB (select/update) se ejecutan con el contexto del usuario y RLS se aplica correctamente.
- **Validación de identidad:** Antes se usaba `supabase.auth.getUser()` sin argumentos. En Edge Functions, en algunos entornos el cliente no usa de forma fiable el header global para `getUser()`, lo que puede provocar 401 aunque el header esté bien enviado.

### Cambio aplicado (solución)

- Se extrae el JWT del header: `const token = authHeader.replace(/^\s*Bearer\s+/i, '').trim()`.
- Si no hay token → 401 con cuerpo `{ error: 'unauthorized', details: 'Missing or invalid Authorization header (expected Bearer <jwt>)' }`.
- Se valida el usuario con **JWT explícito:** `await supabase.auth.getUser(token)`.
- Si `authError` o no hay `user` → 401 con `{ error: 'unauthorized', details: authError?.message ?? 'Invalid or expired JWT' }`.

Así se elimina la dependencia del contexto implícito y se asegura que el fallo sea por JWT inválido/expirado o por no envío del header.

### Otras validaciones antes de `ok: true`

- Método POST; si no → 405.
- Payload JSON válido; si no → 400 `invalid_json`.
- `ride_id` string presente; si no → 400 `invalid_ride_id`.
- `status` en `['en_route','completed']`; si no → 400 `invalid_status`.
- Ride existe y el usuario es el conductor; si no existe → 404 `ride_not_found`; si no es conductor → 403 `forbidden`.
- Update en DB; si falla (p. ej. RLS) → 400 `update_failed` con `details` y `hint`.

Todas las respuestas de error incluyen ahora un cuerpo JSON con `error` y, cuando aplica, `details` (y en update_failed un `hint`), para que el `console.error` del frontend muestre exactamente por qué Supabase rechaza la petición.

---

## 3. Base de datos — RLS en `rides`

Política relevante (migración `034_fix_rides_rls_infinite_recursion.sql`):

```sql
CREATE POLICY "Drivers can update their own rides"
  ON rides FOR UPDATE
  USING (driver_id = auth.uid())
  WITH CHECK (driver_id = auth.uid());
```

- **UPDATE** en `rides` está permitido cuando `driver_id = auth.uid()`.
- La Edge Function usa el cliente con el JWT del usuario, así que PostgREST envía ese JWT y `auth.uid()` en la DB coincide con el conductor. No se usa Service Role; por tanto RLS **sí** se aplica y la política permite al conductor poner `status = 'en_route'`.

**Conclusión:** No es un fallo de RLS por diseño. Si apareciera un error de RLS en el cuerpo de la respuesta (campo `details` o `update_failed`), el `console.error` del frontend lo mostraría; el cambio en la Edge Function incluye un `hint` para ese caso.

---

## 4. Configuración nativa — `AndroidManifest.xml`

- El bloque `<queries>` con el intent `geo` está declarado correctamente en la raíz del `<manifest>`, antes de `<application>`, para que en Android 11+ el sistema resuelva apps de mapas al abrir `geo:...`.

**Conclusión:** No afecta al error "No se pudo iniciar viaje"; solo a la apertura de mapas después de iniciar el viaje.

---

## 5. Resumen de causas y solución

| Causa posible              | Dónde se comprueba                    | Estado / solución |
|---------------------------|----------------------------------------|-------------------|
| **Autenticación (JWT)**   | 401 con `details` en el body          | Corregido: Edge Function usa `getUser(token)` y devuelve `details` en 401. |
| **Autorización (RLS)**    | 400 `update_failed` con mensaje RLS    | RLS correcto para conductor; si falla, el body con `details` + `hint` lo indica. |
| **Payload (ride_id/status)** | 400 `invalid_ride_id` / `invalid_status` | Frontend ya envía `ride_id` y `status` correctos. |

La solución aplicada es en la **Edge Function**: validación explícita del JWT con `getUser(token)` y respuestas de error con cuerpo detallado para que, con el `console.error` ya existente en el frontend, se vea exactamente por qué Supabase rechaza la petición (JWT inválido/vencido, RLS, permisos o payload).

---

## 6. Cómo ver el motivo del rechazo en producción

En el navegador (o WebView con consola):

1. Pulsar **Iniciar viaje**.
2. Si falla, en consola aparecerá algo como:
   ```text
   ride-update-status FAILED { status: 401, statusText: "...", body: { error: "unauthorized", details: "..." } }
   ```
3. Según `body.error` y `body.details`:
   - **unauthorized** + detalles sobre header/JWT → problema de autenticación (token faltante, inválido o expirado).
   - **forbidden** → el usuario no es el conductor del viaje.
   - **ride_not_found** → el `ride_id` no existe o RLS impide verlo (menos probable si el conductor abre su propio viaje).
   - **update_failed** + mensaje que mencione RLS/policy → problema de autorización en la DB; el `hint` en el body orienta hacia `driver_id` vs `auth.uid()`.

---

## Archivos modificados

- **`supabase/functions/ride-update-status/index.ts`**
  - Extracción del token del header `Authorization`.
  - Validación con `getUser(token)`.
  - Respuestas 401/403/404/400 con cuerpo JSON que incluye `error` y `details` (y `hint` en update_failed).

No fue necesario cambiar el frontend (headers y body ya eran correctos), ni las políticas RLS, ni el `AndroidManifest.xml` para el flujo de "Iniciar viaje".
