# Diagnóstico: "Sesión expirada o no válida" al Iniciar viaje (Capacitor + Supabase)

## Instrumentación añadida

### 1. API `POST /api/rides/[id]/update-status`
- **Antes de auth:** `[update-status] AUTH_DEBUG { hasAuthorizationHeader: true|false }`
- **Si auth falla (401/403):** `[update-status] AUTH_DEBUG { result: '401_or_403', status: 401 }`
- **Si auth OK:** `[update-status] AUTH_DEBUG { userId, email }`

### 2. `createServerClient` (server)
- **Siempre en dev:** `[createServerClient] AUTH_DEBUG { authSource: 'Bearer' | 'cookie' }`  
  Indica si el servidor usó el header `Authorization` o las cookies.

### 3. `getAuth` (api-auth)
- **Solo cuando devuelve 401:** `[getAuth] AUTH_DEBUG { authError, hasUser }`  
  Indica el error de Supabase o si no hubo user.

### 4. Frontend (antes del fetch)
- **En consola del navegador/WebView:**  
  `SESSION_CHECK { hasSession, hasToken, expiresAt }`  
  Indica si el cliente tiene sesión y token antes de llamar a la API.

---

## Cómo interpretar los logs

| Escenario | SESSION_CHECK (cliente) | update-status hasAuthorizationHeader | createServerClient authSource | getAuth (si 401) | Causa probable |
|-----------|-------------------------|--------------------------------------|-------------------------------|------------------|-----------------|
| **A) Token expirado** | hasToken: true, expiresAt pasado | true | Bearer | authError presente | Token realmente expirado; refresh puede fallar. |
| **B) Token no se envía** | hasToken: true | **false** | cookie | — | El fetch no incluye header (p. ej. WebView/Capacitor no lo manda). |
| **C) Sin sesión en este origen** | **hasSession: false** o **hasToken: false** | false | cookie | — | Sesión en otro origen (localhost vs 10.0.2.2); WebView no comparte sesión. |
| **D) Middleware** | hasToken: true | depende | depende | — | No hay middleware en el proyecto; descartar si no hay middleware. |

---

## Verificación de env

Confirmar que en el build que usa el emulador/dispositivo:

- `NEXT_PUBLIC_SUPABASE_URL` = URL del proyecto actual (p. ej. `https://xxxx.supabase.co`).
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = anon key del mismo proyecto.

Si la app se sirve desde otro host (Capacitor con `10.0.2.2:3000`), las variables se embeben en el build; no hay “mismatch” de env entre cliente y servidor si ambos son el mismo Next (mismo servidor). El problema típico es **origen del storage** (localhost vs 10.0.2.2), no distinto proyecto.

---

## Causa raíz más probable (Capacitor + Live Reload 10.0.2.2)

**C) Sesión no compartida entre orígenes / token no enviado**

- El usuario inicia sesión en **localhost:3000** (navegador). La sesión se guarda en `localStorage` de `localhost`.
- En el emulador, la app se carga desde **http://10.0.2.2:3000**. Es **otro origen**: `localStorage` de `10.0.2.2:3000` está vacío → `getSession()` devuelve null → no se envía `Authorization` → API devuelve 401.

Alternativa: si el login fue en 10.0.2.2 y SESSION_CHECK muestra `hasToken: true` pero el servidor ve `hasAuthorizationHeader: false`, entonces el problema es **B) el request no incluye el header** (p. ej. limitación del WebView o de la configuración de fetch).

---

## Fix mínimo propuesto

### Si los logs indican (C) – sin sesión en este origen (hasToken: false en cliente)

- **Opción 1 (recomendada):** Usar **siempre el mismo origen** para desarrollo en emulador. Por ejemplo, en el emulador abrir directamente `http://10.0.2.2:3000` y **hacer login ahí**. No mezclar login en localhost y uso en 10.0.2.2.
- **Opción 2:** No cambiar `storageKey`; el cliente ya usa `persistSession: true`. Si en el futuro hubiera múltiples orígenes, se podría usar un `storageKey` fijo (mismo en todos) solo para desarrollo, pero normalmente el fix es no mezclar orígenes.
- **Opción 3:** Si la app en Capacitor apunta a una URL de producción/distinta, asegurar que el login ocurra en esa misma URL (mismo origen que el que luego hace el fetch a `/api/rides/...`).

### Si los logs indican (B) – token no llega (hasToken: true pero hasAuthorizationHeader: false)

- Revisar que el `fetch` en `setRideStatus` siga enviando `headers.Authorization = 'Bearer ' + session.access_token`.
- Comprobar si el WebView o un proxy recortan cabeceras; en ese caso, valorar usar **cookies** para la API (requeriría que el servidor acepte sesión por cookie además de por Bearer; hoy el servidor ya tiene fallback a cookie si no hay Bearer).

### Si los logs indican (A) – token expirado

- El cliente ya hace refresh y reintento ante 401. Si aun así falla, el refresh token puede estar vencido: pedir al usuario **volver a iniciar sesión**.

### Cookie domain (localhost vs 10.0.2.2)

- Las cookies se envían por dominio. `localhost` y `10.0.2.2` son dominios distintos: las cookies de uno no se envían al otro. Por eso en este proyecto la API está pensada para usar **Authorization: Bearer** en Route Handlers. Si el cliente tiene token y lo manda en el header, no depende de cookies. El “cookie domain mismatch” solo afecta si se dependiera solo de cookies; el fix sigue siendo **asegurar que el cliente envíe el Bearer** (y que haya sesión en el mismo origen donde corre la app).

### persistSession

- Cliente: `persistSession: true` ya está en `src/lib/supabase/client.ts`. No hace falta cambiarlo.

---

## Pasos para reproducir y capturar logs

1. En el emulador, abrir la app en `http://10.0.2.2:3000`.
2. **Iniciar sesión en esa misma URL** (no en localhost).
3. Ir a un viaje propio y pulsar "Iniciar viaje".
4. En la **consola del navegador/WebView** (Chrome remote debugging o similar): revisar `SESSION_CHECK`.
5. En la **terminal del servidor Next** (donde corre `npm run dev`): revisar `[update-status] AUTH_DEBUG`, `[createServerClient] AUTH_DEBUG` y, si hay 401, `[getAuth] AUTH_DEBUG`.

Con eso se identifica si el fallo es A, B o C y se aplica el fix mínimo correspondiente.
