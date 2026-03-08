# Auditoría de permisos – App móvil (Next.js + Capacitor Android)

**Rol:** Senior Mobile Engineer + UX Architect  
**Objetivo:** Diagnóstico completo y arquitectura limpia para permisos, sin refactor masivo ni cambios a ciegas.

---

## A) Permisos reales usados por la app

### Android (runtime – el usuario puede aceptar/rechazar)

| Permiso | Uso real | Plugin / origen |
|--------|-----------|------------------|
| **ACCESS_FINE_LOCATION** | Posición actual (mapa, envío al servidor, navegación) | `@capacitor/geolocation` vía `platform.requestLocationPermission()` |
| **ACCESS_COARSE_LOCATION** | Declarado; en la práctica se usa fine | Manifest |
| **ACCESS_BACKGROUND_LOCATION** | Tracking en segundo plano durante viaje (conductor) | Servicio `LocationService` + plugin custom `BackgroundLocation` |
| **SYSTEM_ALERT_WINDOW** | Burbuja flotante “viaje en curso” | Plugin custom `BubbleOverlay` |
| **REQUEST_IGNORE_BATTERY_OPTIMIZATIONS** | Evitar que el sistema mate el tracking en segundo plano | `BackgroundLocation.requestIgnoreBatteryOptimizations()` |
| **Notificaciones (push)** | FCM para notificaciones de la app | `@capacitor/push-notifications` → `PushNotifications.requestPermissions()` |

### Android (declarados, no runtime)

| Permiso | Uso |
|--------|-----|
| INTERNET | Red |
| ACCESS_NETWORK_STATE | Estado de red |
| FOREGROUND_SERVICE, FOREGROUND_SERVICE_LOCATION | Servicio de ubicación en primer plano |
| FOREGROUND_SERVICE_SPECIAL_USE | Servicio de la burbuja flotante |

### No son permisos (pero a veces se confunden)

- **Abrir Maps / Waze / navegador**: `openNavigation()` → intent `geo:` o `Browser.open()`. No pide permiso al usuario; solo abre otra app.
- **Almacenamiento / cache**: `Preferences` (stub con `localStorage` en web). No hay permiso de almacenamiento en Android para datos de app.
- **`navigator.geolocation.getCurrentPosition`**: En web/native con WebView el navegador/sistema puede mostrar su propio diálogo de ubicación; no es un “permiso” gestionado por la app además del runtime de Android.

---

## B) Dónde se solicitan hoy

| Permiso | Archivo | Momento / flujo |
|--------|---------|------------------|
| **Ubicación** | `AppPermissionsRequest.tsx` | Tras login (1,5 s), solo native, una vez por usuario. |
| **Ubicación** | `RideDetailClient.tsx` | `ensureLocationPermissions()` → antes de `startBackgroundTracking()` y al pasar estado a `en_route`. Si falla → modal “Ubicación en segundo plano requerida” + “Ir a ajustes”. |
| **Overlay (burbuja)** | `AppPermissionsRequest.tsx` | Tras login, junto con ubicación y batería. |
| **Overlay** | `RideDetailClient.tsx` | useEffect cuando `ride.status === 'en_route'` (config burbuja) y al pulsar “Iniciar viaje” (`setRideStatus('en_route')`) como fallback. |
| **Batería** | `AppPermissionsRequest.tsx` | Tras login. |
| **Batería** | `RideDetailClient.tsx` | Solo modal Xiaomi: botón “Abrir ajustes de batería” → `BackgroundLocation.openBatterySettings()` (no pide permiso, abre pantalla de ajustes). |
| **Notificaciones** | `RideDetailClient.tsx` | Si `Notification.permission === 'default'` al pasar a `en_route` → `Notification.requestPermission()`. |
| **Push (FCM)** | `PushRegistration.tsx` | Con sesión, 3 s tras montar o al cambiar auth → `registerForPush()` → `PushNotifications.requestPermissions()`. |

### Uso de ubicación sin solicitud explícita en la misma pantalla

- **`src/app/page.tsx`**: “Usar mi ubicación” → `navigator.geolocation.getCurrentPosition` directo (el navegador/WebView pide si hace falta).
- **`src/components/MapComponent.tsx`**: “Mi ubicación” → mismo patrón.
- **`src/components/PickupDropoffMap.tsx`**: validar punto en ruta → `navigator.geolocation.getCurrentPosition` directo.

En estos casos no se llama a `platform.requestLocationPermission()` ni a ninguna capa centralizada; el primer uso de `getCurrentPosition` puede disparar el diálogo del sistema.

---

## C) Qué está mal organizado hoy

1. **Varios puntos de entrada**: Permisos repartidos entre `platform.ts`, `AppPermissionsRequest`, `RideDetailClient`, `PushRegistration`, y uso directo de `navigator.geolocation` / `Notification` en pantallas.
2. **Ubicación “en bloque” tras login**: Se pide ubicación (más overlay y batería) solo por “ya hay sesión”, no cuando el usuario hace una acción que la necesita (ej. publicar viaje, buscar, iniciar viaje). Funciona, pero la UX no sigue el principio “pedir en contexto”.
3. **Overlay repetido**: Se pide en `AppPermissionsRequest` y de nuevo en `RideDetailClient` (useEffect + “Iniciar viaje”). Está atenuado porque si ya está concedido no se muestra diálogo, pero la lógica está duplicada.
4. **Geolocalización fuera de la capa**: `page.tsx`, `MapComponent`, `PickupDropoffMap` no usan `platform.getCurrentPosition()` ni `platform.requestLocationPermission()`; no hay mensaje explicativo previo ni ruta única para “asegurar ubicación antes de usar”.
5. **Push sin explicación**: Se llama a `requestPermissions()` cuando hay sesión (3 s) sin pantalla/modal que explique por qué la app quiere notificaciones.
6. **Pre-check solo en algunos sitios**: `platform.requestLocationPermission()` hace check antes de request; overlay hace `hasOverlayPermission()` antes. No hay una API única tipo `ensureX()` reutilizable en toda la app.

---

## D) Qué partes NO requieren permiso y están confundidas

- **`openNavigation(lat, lng)`**: Solo lanza intent (geo:) o abre URL en Browser. No es un “permiso” de la app; no hay que centralizarlo como permiso, sí como acción de plataforma (ya está en `platform.ts`).
- **`Browser.open` / `AppLauncher.openUrl`**: Idem; son capacidades, no permisos runtime.
- **Almacenamiento (Preferences / localStorage)**: No hay permiso de almacenamiento para datos de app en Android; no incluir en la capa de “permisos”.
- **`Notification.requestPermission()`**: Es la API web de notificaciones; en Android puede coexistir con FCM. Conviene tratarla como “permiso de notificaciones” en la capa de permisos, pero no confundir con “permiso de abrir otra app”.

---

## E) Arquitectura recomendada para centralizar permisos

### Capa única de permisos

- **Ubicación**: `src/lib/mobile/permissions.ts` (o `src/lib/capacitor/permissions.ts`):
  - `checkLocationPermission(): Promise<'granted'|'denied'|'prompt'>`
  - `requestLocationPermission(): Promise<boolean>`
  - `ensureLocationPermission(): Promise<boolean>` (check + request si no granted; opcionalmente mostrar mensaje antes).
- **Overlay**:
  - `checkOverlayPermission(): Promise<boolean>`
  - `requestOverlayPermission(): Promise<boolean>`
  - `ensureOverlayPermission(): Promise<boolean>`
- **Notificaciones (web + push)**:
  - `checkNotificationPermission(): Promise<'granted'|'denied'|'default'>`
  - `requestNotificationPermission(): Promise<boolean>` (web y/o push según contexto).
- **Batería** (solo native):
  - `requestBatteryOptimization(): Promise<void>` (abre diálogo del sistema; no “check” estándar).
- **Por acción** (opcional):
  - `ensurePermissionForAction(action: 'location' | 'background_location' | 'overlay' | 'notifications'): Promise<boolean>`  
  - Internamente decide qué permiso(s) pedir y opcionalmente muestra mensaje explicativo.

La capa debe **delegar en `platform.ts`** (y en plugins de Capacitor) para no duplicar lógica nativa. Es decir: `permissions.ts` es la fachada; `platform.ts` sigue siendo quien habla con Capacitor/navigator.

### Mapa de flujos recomendado (objetivo a futuro)

| Acción del usuario | Permiso(s) | Cuándo pedir |
|--------------------|------------|--------------|
| Iniciar sesión | Ninguno | — |
| Ver mapa / “Usar mi ubicación” en búsqueda o publicar | Ubicación | Justo antes de `getCurrentPosition` (o al tocar “Usar mi ubicación”). Mensaje corto: “Para mostrarte en el mapa y proponer direcciones”. |
| Habilitar notificaciones / primer uso que las necesite | Notificaciones (push o web) | Al intentar activar notificaciones o cuando el flujo lo requiera; mensaje previo. |
| Iniciar viaje como conductor | Ubicación (foreground + background), overlay, batería | Opción A: seguir pidiendo tras login (actual). Opción B: pedir en este momento (location al tocar “Iniciar viaje”, overlay cuando se vaya a mostrar burbuja, batería antes de iniciar tracking). |
| Abrir navegación (Maps/Waze) | Ninguno | Solo abrir intent/URL. |

---

## F) Archivos exactos a tocar para ordenar

| Archivo | Cambio |
|---------|--------|
| **Creado** `src/lib/mobile/permissions.ts` | Capa centralizada: check/request/ensure por permiso; delega en `platform.ts` y en plugins; documenta flujos. `AppPermissionsRequest` ya lo usa. |
| `src/lib/platform.ts` | Sin cambios de contrato; sigue siendo la única que usa Capacitor/navigator. Opcional: que `permissions.ts` lo use y no al revés. |
| `src/components/AppPermissionsRequest.tsx` | Que use `permissions.*` en lugar de importar `platform` directamente; mismo comportamiento (pedir tras login). |
| `src/app/rides/[id]/RideDetailClient.tsx` | Reemplazar llamadas a `platform.requestLocationPermission()` y `platform.requestOverlayPermission()` por `permissions.ensureLocationPermission()` y `permissions.ensureOverlayPermission()` (o mantener platform si permissions solo reexporta). Mantener modales de “Ir a ajustes” y Xiaomi. |
| `src/app/page.tsx` | Opcional (más riesgo): antes de `getCurrentPosition`, en native llamar a `permissions.ensureLocationPermission()` y mensaje breve. |
| `src/components/MapComponent.tsx` | Idem. |
| `src/components/PickupDropoffMap.tsx` | Idem. |
| `src/lib/capacitor/pushNotifications.ts` | Sin cambio obligatorio; opcional: que quien llame a `registerForPush()` muestre antes un mensaje (p. ej. desde `PushRegistration` o una pantalla de ajustes). |
| `docs/PERMISOS_APP_NATIVA.md` | Referenciar este informe y la capa `permissions.ts`. |

---

## G) Qué cambios son seguros hacer ya

1. **Crear `src/lib/mobile/permissions.ts`** que:
   - Exporte `checkLocationPermission`, `requestLocationPermission`, `ensureLocationPermission` (delegando en `platform`).
   - Exporte `checkOverlayPermission`, `requestOverlayPermission`, `ensureOverlayPermission` (delegando en `platform` / BubbleOverlay).
   - Exporte `requestBatteryOptimization` (delegando en `platform`).
   - Opcionalmente `checkNotificationPermission` / `requestNotificationPermission` para web + push.
   - No cambie momentos ni flujos; solo centraliza la API y documenta en comentarios qué flujo usa cada una.
2. **Sustituir en `AppPermissionsRequest` y `RideDetailClient`** las llamadas directas a `platform.request*` por `permissions.request*` o `permissions.ensure*` **sin cambiar cuándo se piden** (mismo “tras login” y mismo “al iniciar viaje / burbuja”). Así no se rompen flujos.
3. **Revisar AndroidManifest**: No sobran permisos; todos los declarados se usan. No quitar nada sin probar en dispositivo.

---

## H) Qué conviene dejar para después de pruebas manuales

1. **Pedir ubicación solo “en contexto”** (al tocar “Usar mi ubicación” o al iniciar viaje) en lugar de en bloque tras login. Requiere definir bien los flujos y probar en Android que no se pierde ninguna funcionalidad.
2. **Mensajes explicativos** antes de cada permiso (copy + modales). Requiere diseño y validación con usuarios.
3. **Unificar `page.tsx`, `MapComponent`, `PickupDropoffMap`** para usar `platform.getCurrentPosition()` y, en native, `permissions.ensureLocationPermission()` antes del primer uso. Requiere tocar varias pantallas y probar en web y en app.
4. **Push**: pantalla o modal “¿Querés recibir notificaciones de viajes?” antes de `registerForPush()`. Requiere decidir en qué pantalla se muestra y probar en dispositivo.

---

## Resumen AndroidManifest

- **Declarados y usados**: INTERNET, ACCESS_NETWORK_STATE, ACCESS_COARSE_LOCATION, ACCESS_FINE_LOCATION, ACCESS_BACKGROUND_LOCATION, FOREGROUND_SERVICE*, SYSTEM_ALERT_WINDOW, REQUEST_IGNORE_BATTERY_OPTIMIZATIONS.
- **Sobran**: Ninguno detectado.
- **Faltan**: Ninguno para los flujos actuales.
- **`<queries>` geo**: Necesario para resolver apps de mapas en Android 11+.

---

## Plugins de Capacitor involucrados

- `@capacitor/core`, `@capacitor/app`
- `@capacitor/geolocation` (permiso ubicación)
- `@capacitor/app-launcher`, `@capacitor/browser` (navegación; no permisos)
- `@capacitor/push-notifications` (permiso notificaciones)
- `@capacitor/preferences` (stub en web; no permiso)
- Plugins custom: `BackgroundLocation`, `BubbleOverlay`, `Navigation` (este último solo intent; no permiso).
