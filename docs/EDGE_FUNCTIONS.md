# Edge Functions - Xhare

## `ride-update-status`

Función Edge para actualizar el estado de un viaje desde la app (web / APK) sin pasar por las rutas `/api/rides/...` de Next. Pensada para acciones críticas como **“Iniciar viaje”**.

### Código

Ubicación: `supabase/functions/ride-update-status/index.ts`

Responsabilidades:

- Leer el header `Authorization: Bearer <jwt>` enviado por el cliente.
- Crear un Supabase client con `SUPABASE_URL` y `SUPABASE_ANON_KEY`.
- Validar el usuario con `supabase.auth.getUser()`.
- Verificar que el usuario sea el **driver dueño del viaje**.
- Actualizar `rides.status` (y `started_at` / `completed_at` si aplica).
- Responder JSON claro:
  - 200 → `{ ok: true, ride_id, status }`
  - 4xx/5xx → `{ error: string, details? }`

### Comandos para desplegar (Windows / PowerShell)

Desde la raíz del proyecto (`C:\Users\PCera\transporte`):

```powershell
supabase login
```

Si el proyecto local todavía no está linkeado al proyecto de Supabase:

```powershell
supabase link --project-ref ycjhcmpsbjqfurbmaqrt
```

> Reemplazar `ycjhcmpsbjqfurbmaqrt` si tu ref de proyecto cambiara en el futuro (actualmente coincide con el URL en `.env.local`).

Luego, desplegar la función:

```powershell
supabase functions deploy ride-update-status
```

Esto compilará y subirá la función a Supabase Edge Functions con el nombre `ride-update-status`.

### Secrets / variables de entorno

La función espera encontrar:

- `SUPABASE_URL` (o `NEXT_PUBLIC_SUPABASE_URL`)
- `SUPABASE_ANON_KEY` (o `NEXT_PUBLIC_SUPABASE_ANON_KEY`)

En la UI de Supabase:

1. Ir a **Project Settings → API** y copiar:
   - `Project URL` → `SUPABASE_URL`
   - `anon public` key → `SUPABASE_ANON_KEY`
2. Ir a **Project Settings → Configuration → Secrets** (o `supabase secrets` en CLI) y definir:

```bash
supabase secrets set SUPABASE_URL="https://ycjhcmpsbjqfurbmaqrt.supabase.co"
supabase secrets set SUPABASE_ANON_KEY="<anon_public_key>"
```

> No uses la `service_role` en esta función. El client usa la anon key + JWT del usuario (Authorization header), por lo que respetará las RLS existentes.

### Flujo end-to-end (app → Edge → DB)

1. La app (web / APK) obtiene sesión con `supabase.auth.getSession()` (interno de Supabase).
2. Al invocar `supabase.functions.invoke('ride-update-status', ...)`, el cliente envía el JWT del usuario en `Authorization`.
3. La Edge Function:
   - Valida el usuario.
   - Verifica que `rides.driver_id === user.id`.
   - Actualiza `rides.status` (y `started_at` / `completed_at`).
4. La app recibe `{ ok: true, ride_id, status }` y actualiza la UI (`loadRide()`).

### Checklist de prueba (APK / web)

1. Desplegar `ride-update-status`:
   - `supabase functions deploy ride-update-status`
2. Asegurar que el frontend (`src/app/rides/[id]/page.tsx`) esté desplegado en Vercel con el commit que llama a `supabase.functions.invoke('ride-update-status', ...)`.
3. En el teléfono:
   - Abrir Chrome → `https://xhare-ashy.vercel.app`
   - Iniciar sesión como **conductor**.
   - Abrir un viaje propio `/rides/[id]`.
   - Tocar **“Iniciar viaje”** → el viaje debe pasar a `en_route` sin mostrar “Sesión expirada o no válida”.
4. Abrir el **APK** (que apunta a `https://xhare-ashy.vercel.app`) y repetir el mismo flujo.

