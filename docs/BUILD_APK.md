# Generar APK de prueba (Capacitor Android)

## Configuración (capacitor.config.ts)

- **Live reload (dev):** `CAP_LIVE_RELOAD=1` → `server.url = 'http://10.0.2.2:3000'`. Solo para desarrollo.
- **APK estable (producción):** `CAP_APP_URL=https://TU-APP.vercel.app` → la app carga desde esa URL. No definir `CAP_LIVE_RELOAD`.
- **Ninguno:** No se define `server`; la app usa solo `webDir` (carpeta `public`). No hay URLs hardcodeadas.

## APK debug estable apuntando a Vercel (automático, sin live reload)

APK instalable para varios Android que carga la app desde Vercel (sin PC, sin localhost, sin 10.0.2.2). No usar `CAP_LIVE_RELOAD` ni `npm run build`; la app se sirve desde Vercel. Reemplazá `https://TU-APP.vercel.app` por tu URL real (ej. `https://xhare.vercel.app`).

### PowerShell (copiar/pegar — un comando por línea)

```
cd C:\Users\PCera\transporte
```
```
$env:CAP_APP_URL="https://TU-APP.vercel.app"
```
```
npx cap sync android
```
```
cd android
```
```
.\gradlew.bat clean assembleDebug
```

### Git Bash (copiar/pegar — un comando por línea)

```
cd /c/Users/PCera/transporte
```
```
export CAP_APP_URL="https://TU-APP.vercel.app"
```
```
npx cap sync android
```
```
cd android
```
```
./gradlew.bat clean assembleDebug
```

### Opcional: bloque completo (una línea = un comando)

**PowerShell:**
```powershell
cd C:\Users\PCera\transporte
$env:CAP_APP_URL="https://TU-APP.vercel.app"
npx cap sync android
cd android
.\gradlew.bat clean assembleDebug
```

**Git Bash:**
```bash
cd /c/Users/PCera/transporte
export CAP_APP_URL="https://TU-APP.vercel.app"
npx cap sync android
cd android
./gradlew.bat clean assembleDebug
```

### Ruta exacta del APK

```
android/app/build/outputs/apk/debug/app-debug.apk
```

### Instalar en el teléfono (ADB)

Desde la raíz del proyecto (`C:\Users\PCera\transporte`), con el dispositivo conectado por USB y depuración USB activada:

```
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

### Checklist de prueba en teléfonos

- [ ] **Login y sesión persistente** (iniciar sesión y que la sesión se mantenga al reabrir la app).
- [ ] **Publicar viaje** (crear/publicar un viaje como conductor).
- [ ] **Iniciar viaje NO muestra "Sesión expirada"** (al tocar "Iniciar viaje" no aparece el alert de sesión expirada).
- [ ] **Abrir mapa** (origen / punto actual / siguiente) abre Google Maps o el fallback en el navegador.

---

## Flujo para APK debug (rápido, sin CAP_APP_URL)

```bash
npm install
npm run build
npx cap sync android
cd android
.\gradlew.bat clean assembleDebug
```

Desde la raíz del proyecto (Windows):

```bash
cd android && .\gradlew.bat clean assembleDebug
```

## Rutas exactas del APK

| Variante | Ruta |
|----------|------|
| **Debug** | `android\app\build\outputs\apk\debug\app-debug.apk` |
| **Release (unsigned)** | `android\app\build\outputs\apk\release\app-release-unsigned.apk` |

## Instalar en el teléfono

### Con ADB (recomendado)

1. Activar **Opciones de desarrollador** y **Depuración USB** en el Android.
2. Conectar por USB y aceptar la depuración.
3. Instalar (reemplaza si ya está instalada):

```bash
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

Desde la raíz del proyecto:

```bash
adb install -r c:\Users\PCera\transporte\android\app\build\outputs\apk\debug\app-debug.apk
```

### Sin ADB: copiar el APK al teléfono

1. Copiar el archivo `app-debug.apk` al teléfono (USB como almacenamiento, correo, Drive, etc.).
2. En el Android, abrir el archivo y permitir **Instalar desde fuentes desconocidas** si lo pide.
3. Confirmar la instalación.

## Release (unsigned, opcional)

```bash
cd android
.\gradlew.bat assembleRelease
```

Salida: `android\app\build\outputs\apk\release\app-release-unsigned.apk`. Para publicar en Play Store hace falta firmar el APK (keystore).

## Resumen de variables de entorno

| Variable | Uso |
|----------|-----|
| `CAP_LIVE_RELOAD=1` | Dev: WebView apunta a `10.0.2.2:3000`. Usar solo para desarrollo con live reload. |
| `CAP_APP_URL=https://...` | APK: WebView carga la app desde esa URL. Sin esto y sin live reload, el APK usa solo `public/`. |

Para probar en varios Android sin servidor local: desplegar la app Next (Vercel, etc.) y generar el APK con `CAP_APP_URL` apuntando a esa URL antes de `npx cap sync android`.
