# Permisos en la app nativa (Android)

**Capa centralizada:** toda la lógica de permisos pasa por `src/lib/mobile/permissions.ts`, que delega en `platform.ts` y en plugins de Capacitor. No se duplica lógica nativa.

---

## Lista de permisos usados

| Permiso (Android / uso en app) | Runtime | Dónde se usa |
|--------------------------------|--------|---------------|
| **Ubicación** (ACCESS_FINE_LOCATION / ACCESS_COARSE) | Sí | Mapa, envío de posición, tracking, navegación |
| **Ubicación en segundo plano** (ACCESS_BACKGROUND_LOCATION) | Sí | Conductor: tracking durante viaje en curso |
| **Overlay** (SYSTEM_ALERT_WINDOW) | Sí | Burbuja flotante "viaje en curso" |
| **Batería** (REQUEST_IGNORE_BATTERY_OPTIMIZATIONS) | Sí (diálogo sistema) | Evitar que el sistema mate el tracking en segundo plano |
| **Notificaciones push** (FCM) | Sí | Avisos de viajes; se pide en `PushRegistration` vía `registerForPush()` |

La capa de código que los solicita/comprueba es **`src/lib/mobile/permissions.ts`** (que a su vez usa `platform.ts` y plugins).

---

## Qué flujo usa cada permiso

| Permiso | Flujo que lo usa |
|---------|-------------------|
| Ubicación | Búsqueda/publicar ("Usar mi ubicación"); detalle viaje (enviar posición); conductor (tracking) |
| Ubicación en segundo plano | Conductor: tracking cuando el viaje está en curso |
| Overlay | Conductor: burbuja flotante cuando el viaje está en curso |
| Batería | Conductor: no matar app en segundo plano durante el viaje |
| Notificaciones | Push: avisos de viajes; web: notificación "Viaje en curso" |

---

## Cuándo se solicita cada permiso

| Permiso | Cuándo se solicita |
|---------|---------------------|
| Ubicación | Tras login (native), en `AppPermissionsRequest`; y en `RideDetailClient` antes de tracking / al pasar a en_route (fallback) |
| Overlay | Tras login (native), en `AppPermissionsRequest`; y en `RideDetailClient` al configurar burbuja / "Iniciar viaje" (fallback) |
| Batería | Tras login (native), en `AppPermissionsRequest` |
| Notificaciones push | Cuando hay sesión (native), en `PushRegistration` (delay 3 s), vía `registerForPush()` |
| Notificaciones web | En `RideDetailClient` al pasar viaje a `en_route` si `Notification.permission === 'default'` |

**No se ha cambiado el momento** en que se pide ningún permiso; solo se ha centralizado la llamada en `permissions.ts` donde aplica.

---

## Auditoría (problemas de fondo corregidos)

- **Problema 1**: Los permisos se pedían al cargar la app (timeout 1,5 s) **sin comprobar sesión**, por lo que usuarios no logueados veían diálogos de ubicación, overlay y batería nada más abrir la app. **Solución**: Pedir permisos solo cuando exista sesión (usuario logueado); ver `AppPermissionsRequest` y `onAuthStateChange` + `getSession()`.
- **Problema 2**: Overlay y batería aparecían también al pulsar "Iniciar viaje" porque (a) se pedían al inicio sin sesión y (b) en `setRideStatus('en_route')` se volvía a pedir overlay. **Solución**: Pedir todos los permisos una sola vez **después del login** (1,5 s de retraso); en "Iniciar viaje" solo se llama a `requestOverlayPermission()` como fallback (si ya está concedido no se muestra diálogo).
- **Problema 3**: No había una regla de producto clara. **Solución**: Regla explícita: permisos solo tras iniciar sesión, una vez por usuario; documentado en este archivo.

## Regla de producto

Los permisos que requieren interacción del usuario (ubicación, sobreponerse sobre otras apps, batería) **solo se solicitan después de que el usuario haya iniciado sesión**, no al abrir la app.

- **Por qué**: Evitar diálogos a usuarios que solo están mirando o antes de login; la petición tiene contexto (“vas a usar la app como conductor/pasajero”).
- **Dónde**: En `AppPermissionsRequest`, que escucha la sesión de Supabase y, cuando hay usuario logueado y la app es nativa, pide los permisos **una vez por usuario** (no en cada carga).

## Orden y momento

1. **Sin sesión**: no se pide ningún permiso.
2. **Tras iniciar sesión** (en native): tras un breve retraso (~1,5 s), se piden en este orden:
   - Ubicación (para seguimiento y navegación)
   - Sobreponer sobre otras apps (burbuja flotante en viaje en curso)
   - Batería (ignorar optimización para tracking en segundo plano)
3. **Al pulsar "Iniciar viaje"**: no se debe mostrar de nuevo el permiso de batería ni el de sobreponerse; ya se habrán pedido tras el login. En la pantalla del viaje se puede llamar a `requestOverlayPermission()` por si se denegó antes (para la burbuja); si ya está concedido, no se muestra diálogo.

## Implementación

- `src/components/AppPermissionsRequest.tsx`: usa `supabase.auth.getSession()` y `onAuthStateChange`; solo ejecuta la petición de permisos cuando `session != null` y `isNative()`, y solo una vez por `session.user.id` por sesión de la app. Delega en `src/lib/mobile/permissions.ts`.
- La pantalla del viaje (`RideDetailClient`) sigue usando `platform.requestOverlayPermission()` cuando configura la burbuja; si el permiso ya fue concedido tras el login, la llamada es efectivamente un no-op (no se muestra diálogo).
- Auditoría completa y arquitectura recomendada: `docs/AUDITORIA_PERMISOS_APP.md`.

## Resumen

| Permiso      | Cuándo se pide        | Cuándo no se pide      |
|-------------|------------------------|-------------------------|
| Ubicación   | Tras login (native)    | Sin sesión; en web N/A  |
| Overlay     | Tras login (native)    | Sin sesión; al abrir app|
| Batería     | Tras login (native)    | Sin sesión; en "Iniciar viaje" |

---

## Referencia a permissions.ts

**Archivo:** `src/lib/mobile/permissions.ts`

**Funciones exportadas (fachada de permisos):**

- **Ubicación:** `checkLocationPermission()`, `requestLocationPermission()`, `ensureLocationPermission()`
- **Overlay:** `checkOverlayPermission()`, `requestOverlayPermission()`, `ensureOverlayPermission()`
- **Batería:** `requestBatteryOptimization()`
- **Notificaciones:** `checkNotificationPermission()`, `requestNotificationPermission()`
- **Genérico:** `ensurePermissionForAction(action)`

Esta capa **no duplica lógica**: delega en `platform.ts` (y en plugins como `BubbleOverlay`, `rideNative` para `check*` de ubicación). `platform.ts` sigue siendo la única que habla con Capacitor. Los componentes que quieran pedir permisos de forma centralizada deben usar `permissions.*`; los que ya usan `platform.*` (p. ej. `RideDetailClient`) pueden seguir así hasta una fase posterior.
