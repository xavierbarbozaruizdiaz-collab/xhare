# Verificación pre-APK (revisión técnica)

**Fecha:** 2025-03  
**Alcance:** Permisos, navegación (app elegida con destino), ubicación (no repetir diálogo), flujos en detalle de viaje.

---

## 1. Permisos de la app (Configuraciones → Permisos de la app)

| Punto | Estado |
|-------|--------|
| Estado de **Ubicación** viene del plugin Geolocation (`checkPermissions`) | OK |
| Estado de **Notificaciones** en nativo viene de `PushNotifications.checkPermissions()` (no solo web) | OK |
| Al volver de Ajustes se refresca con `visibilitychange` | OK |
| Botones abren Ajustes / Batería según corresponda | OK |

---

## 2. Ubicación: no repetir diálogo del sistema

| Punto | Estado |
|-------|--------|
| En nativo, `requestLocationPermission()` usa primero el plugin (no devuelve `true` solo por `navigator.geolocation`) | OK |
| Se llama `checkPermissions()` y solo si no está `granted` se llama `requestPermissions()` | OK |
| Evita que el diálogo aparezca de nuevo si ya está concedido | OK |

---

## 3. Navegación: abrir la app elegida con el destino

| Punto | Estado |
|-------|--------|
| Preferencia guardada en Capacitor Preferences + localStorage | OK |
| En nativo se pasa `package` al plugin (Google Maps / Waze) para abrir la app directamente | OK |
| URI Google: `google.navigation:q=lat,lng` (sin codificar coma) | OK |
| URI Waze: `waze://?ll=lat,lng&navigate=yes` | OK |
| Si la app preferida no está instalada, el plugin muestra chooser o fallback en JS abre navegador | OK |
| Preferencia "Navegador" y "Preguntar cada vez" abren el navegador | OK |

**Ajustes hechos en esta revisión:**
- Página de preferencia de navegación muestra las 4 opciones: Google Maps, Waze, Navegador, Preguntar cada vez.
- Plugin Android: cuando la app preferida no está instalada se usa explícitamente el chooser (`useChooser`).

---

## 4. Flujo detalle de viaje (conductor)

| Punto | Estado |
|-------|--------|
| "Ir al punto actual" / "Continuar viaje" llaman a `platform.openNavigation(lat, lng, label)` | OK |
| Se respeta la preferencia de navegación (Google Maps / Waze / navegador) | OK |
| "Llegué" abre modal para confirmar pasajeros en la parada | OK |
| "Finalizar viaje" actualiza estado y detiene tracking en segundo plano | OK |

---

## 5. Acceso a Configuraciones

| Punto | Estado |
|-------|--------|
| Enlace "Preferencia de navegación" desde búsqueda, inicio y mis viajes (menú config) | OK |
| Enlace "Permisos de la app" en los mismos menús | OK |

---

## Resumen

- Flujos de permisos, ubicación y navegación están alineados con el comportamiento deseado.
- Ajustes aplicados: opciones completas en preferencia de navegación (incl. Navegador y Preguntar cada vez) y fallback a chooser en el plugin cuando la app preferida no está instalada.
- Para que todo aplique en el dispositivo hay que **generar e instalar un nuevo APK** (el plugin nativo cambió).

---

## Cómo generar el APK

Desde la raíz del proyecto (PowerShell):

```bash
npm run android:apk
```

Esto hace: `next build` → `cap sync android` → `gradlew clean assembleDebug`.  
El APK de debug queda en:

`android/app/build/outputs/apk/debug/app-debug.apk`

Para instalar en el teléfono: copiá ese archivo al dispositivo e instalalo, o conectá el celular por USB con depuración activada y usá Android Studio / `adb install app-debug.apk`.
