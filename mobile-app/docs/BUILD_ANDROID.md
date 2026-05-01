# Xhare — Cómo correr y compilar la app Android

## Requisitos

- Node 18+
- Android Studio (incluye SDK) y un emulador o dispositivo conectado
- Para **desarrollo con dispositivo**: Expo Go (opcional) o emulador Android

---

## 1. Variables de entorno

En la raíz de `mobile-app` debe existir un archivo `.env` (podés copiarlo desde `.env.example`):

```
EXPO_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=tu-anon-key
```

**Recomendado** (para reservas alineadas con web: paradas subida/bajada y precio por tramo):

```
EXPO_PUBLIC_API_BASE_URL=https://tu-dominio.vercel.app
```

- Reemplazá por la URL base de tu backend Next.js (donde está `POST /api/route/segment-stats`). Sin barra final.
- Sin esta URL: en viajes con paradas no se calcula el precio por tramo y se usa la tarifa mínima; tampoco funcionan push, valoraciones, paradas extra, llegada a parada, etc.

**APK firmado para distribución (Play / testers “de verdad”)**: usá **EAS Build** (`npm run build:android:cloud:apk:preview` o `…:production` y perfiles en `eas.json`). Ahí van los secretos de firma y Maps; no hace falta keystore en la PC.

**Release local** (`npm run build:android:release:*`): sin las cuatro variables de abajo, Gradle firma el `release` con **keystore debug** (solo smoke / CI interno; **no** es el flujo de tienda).

Opcional, si querés APK `release` firmado con tu propio keystore en la máquina (el script carga `.env` y `.env.local`):

```
ANDROID_RELEASE_STORE_FILE=release.keystore
ANDROID_RELEASE_STORE_PASSWORD=******
ANDROID_RELEASE_KEY_ALIAS=xhare_release
ANDROID_RELEASE_KEY_PASSWORD=******
```

- `ANDROID_RELEASE_STORE_FILE`: ruta **absoluta** o **relativa a `mobile-app/`** (no a `android/`).

Sin `.env` la app arranca pero login con Supabase no funcionará hasta configurarlas.

---

## 2. Instalar dependencias

```bash
cd C:\Users\PCera\transporte\mobile-app
npm install
```

---

## 3. Correr la app en desarrollo

### Opción A — Metro + Expo Go (recomendado para probar rápido)

```bash
cd C:\Users\PCera\transporte\mobile-app
npx expo start
```

- Se abre Metro y un QR en la terminal.
- En el teléfono Android: abrí **Expo Go** y escaneá el QR, o tocá el link que aparece.
- Para abrir directo en emulador Android: en la misma terminal donde corre `expo start`, apretá **`a`**.

Comandos equivalentes:

```bash
npm start
# o
npx expo start --android
```

### Opción B — App nativa en dispositivo/emulador (sin Expo Go)

Genera la carpeta Android y compila localmente (requiere Android Studio / SDK instalado):

```bash
cd C:\Users\PCera\transporte\mobile-app
npx expo prebuild --platform android
npx expo run:android
```

- La primera vez puede tardar varios minutos.
- Si tenés un dispositivo conectado por USB con depuración USB activada, se instalará ahí; si no, en el emulador.

---

## 4. Generar RELEASE local firmado (FORMA OFICIAL)

Esta es la **única forma oficial** de generar un build release local firmado en este proyecto.

```bash
cd C:\Users\PCera\transporte\mobile-app
cd android
gradlew clean
cd ..
npx expo run:android --variant release
```

Esto hace:

- (1) Limpia el build Android (`gradlew clean`)
- (2) Compila e instala el **variant `release`** en el dispositivo/emulador

### Dónde queda el output local

El archivo queda en:

`android/app/build/outputs/apk/release/app-release.apk`

---

## 5. Cloud build (bajo pedido)

**Importante (EAS):** no versionar una carpeta `android/` **a medias** en git (solo unos pocos archivos). Eso hace que el worker detecte `android/`, ignore `android.package` de `app.config.js` y ejecute Gradle sobre un árbol incompleto → fallos en `Run gradlew`. La carpeta nativa completa debe generarse en el worker con **prebuild** (o estar el `android/` entero versionado, no recomendado aquí). En este monorepo, `mobile-app/android/` queda en `.gitignore`; no subas fragmentos bajo `mobile-app/android/`.

Solo si se pide explícitamente usar EAS Build:

- `npm run build:android:cloud:apk:preview`
- `npm run build:android:cloud:aab:production` (**Play Store**)

Notas:
- `preview` mantiene `APK` para pruebas internas.
- `production` genera `AAB` para publicación en Play Store (sabor **pasajero** `com.xhare.app`).
- Conductor (`com.xhare.driver`): `npm run build:android:cloud:aab:production:driver` o `eas build --profile production_driver` (no uses variables globales `*_APP_FLAVOR=driver` para el perfil pasajero).
- Si en **`.env.local`** tenés `EXPO_PUBLIC_APP_FLAVOR=driver` para desarrollo, no pasa nada: en contexto `eas build` / worker EAS, `app.config.js` **no aplica** esas dos claves desde `.env.local` para que no reemplace el perfil del build.

---

## 6. Cómo instalar el APK en el teléfono

1. Descargar el APK (desde el link de Expo en el teléfono o en la PC y pasarlo al móvil).
2. En Android: **Ajustes → Seguridad** (o **Aplicaciones**) y permitir **Instalar apps desconocidas** para el navegador o el gestor de archivos que uses.
3. Abrir el archivo `.apk` y tocar **Instalar**.

---

## 7. Resumen de comandos

| Objetivo | Comando |
|----------|---------|
| Levantar en desarrollo (Expo Go) | `cd mobile-app` → `npx expo start` → en terminal `a` o escanear QR |
| Levantar en dispositivo/emulador nativo | `npx expo prebuild --platform android` y luego `npx expo run:android` |
| Release local firmado (OFICIAL) | `npm run build:android:release` |
| Cloud build (bajo pedido) | `npm run build:android:cloud:apk:preview` / `npm run build:android:cloud:aab:production` |

---

## 8. Si algo falla al arrancar

- **“Unable to resolve module”**: ejecutá `npm install` de nuevo y `npx expo start --clear`.
- **Login no funciona**: revisá que `.env` tenga `EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_ANON_KEY` correctos.
- **Build local release falla**: abrí Android Studio, verificá SDK/Java, y reintentá `npm run build:android:release`.
