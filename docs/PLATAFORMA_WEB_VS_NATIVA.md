# Plataforma: Web vs Nativa

La app se sirve desde el mismo bundle (Vercel) en dos contextos:

- **Web:** navegador (Chrome, Safari, etc.) o PWA. No hay bridge de Capacitor.
- **Nativa:** APK Android que carga la misma URL en un WebView con Capacitor; los plugins nativos están disponibles.

Para no mezclar condicionales en cada pantalla y evitar errores como `Geolocation.then() is not implemented on web`, toda la lógica que depende del entorno está en **una sola capa**: `src/lib/platform.ts`.

## Contrato de la capa

La UI (p. ej. `RideDetailClient`) **solo** usa las funciones exportadas por `platform`. No importa `@capacitor/*` ni usa `navigator.geolocation` directamente en flujos críticos.

| Función | Web | Nativa |
|--------|-----|--------|
| `isNative()` | `false` | `true` |
| `getCurrentPosition()` | `navigator.geolocation` | `navigator.geolocation` (mismo código; en WebView está disponible) |
| `requestLocationPermission()` | `true` si existe `navigator.geolocation` | Intenta Capacitor; si falla devuelve `true` para no bloquear |
| `openNavigation(lat, lng, label)` | `window.open(Google Maps URL)` | `AppLauncher.openUrl(geo:)` → fallback `Browser.open` → `window.open` |
| `requestOverlayPermission()` | `false` (no aplica) | Delega en plugin Burbuja |
| `showBubble()` / `hideBubble()` | No-op | Plugin Burbuja |
| `onAppStateChange(cb)` | No-op, devuelve cleanup vacío | `App.addListener('appStateChange', cb)` |

## Ubicación

- **Nunca** se usa el plugin `@capacitor/geolocation` para obtener la posición en esta capa cuando existe `navigator.geolocation`, para evitar el error en WebView/navegador.
- Si en el futuro se quiere usar el plugin en native para algo específico, debe hacerse **dentro** de `platform.ts` y solo cuando `isNative()` es true.

## Navegación

- En native se intenta primero `geo:lat,lng` (selector de apps: Maps, Waze, etc.); si falla, se abre la URL de Google Maps en el Browser o en una nueva pestaña.

## Burbuja flotante

- Solo se pide permiso y se muestra/oculta cuando `isNative()` es true. En web las funciones son no-op o devuelven false.

## Cómo extender

- Nuevas capacidades que dependan de “web vs nativo” se añaden en `platform.ts` y se usan desde la UI.
- No añadir en componentes más condicionales del tipo “if native then Capacitor else navigator”; eso vive en la capa.
