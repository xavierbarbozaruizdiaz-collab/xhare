# Xhare — App móvil (Expo)

App móvil nativa (React Native vía Expo) para conductores y pasajeros. Backend único: Supabase + panel web Next.js (admin, pricing, billing).

## Stack

- **Expo** (React Native)
- **Supabase** (auth, DB, edge functions)
- **React Navigation** (stack + bottom tabs)

## Requisitos

- Node 18+
- Cuenta Expo (`npx expo login`)
- Supabase: mismo proyecto que el panel web (mismas env)

## Configuración

1. Copiar variables de entorno:
   ```bash
   cp .env.example .env
   ```
2. En `.env` definir:
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   (Mismos valores que `NEXT_PUBLIC_SUPABASE_*` del proyecto raíz.)

3. Para cargar `.env` en Expo, usar `expo-env` o definir en `app.config.js`/`app.config.ts` (ver [Expo env](https://docs.expo.dev/guides/environment-variables/)).

## Cómo correr y generar APK Android

**Comandos exactos** para desarrollo y build real están en **[docs/BUILD_ANDROID.md](docs/BUILD_ANDROID.md)**.

- **Desarrollo**: `npx expo start` → en terminal `a` o escanear QR con Expo Go.
- **APK release local (OFICIAL)**: `npm run build:android:release` → APK en `android/app/build/outputs/apk/release/app-release.apk`.

## Scripts

- `npm start` — inicia Expo (escanea QR con Expo Go)
- `npm run android` — abre en emulador/dispositivo Android
- `npm run android:run` — compila y corre en dispositivo/emulador (requiere `npx expo prebuild --platform android` antes)
- `npm run ios` — abre en simulador iOS (solo macOS)
- `npm run build:android:release` — **APK release local (flujo oficial)**: clean + `expo run:android --variant release`
- `npm run build:android:cloud:apk:preview` — Cloud build (bajo pedido): EAS preview APK
- `npm run build:android:cloud:apk:production` — Cloud build (bajo pedido): EAS production APK

## Estructura

```
src/
  auth/          — AuthContext, session, SecureStorage
  backend/       — cliente Supabase
  core/          — env
  external-navigation/ — abrir Maps / Waze
  navigation/    — RootNavigator (Auth | Main tabs)
  permissions/   — ubicación (y notificaciones)
  rides/         — API de viajes (my rides, detail)
  screens/       — Login, Home, Driver, Passenger, Settings
  settings/      — preferencia de navegación
  types/         — tipos compartidos con backend
  ui/            — LoadingScreen, etc.
```

## Módulos a expandir

- **driver**: lista de viajes, publicar, detalle, actualizar estado (edge `ride-update-status`), ubicación en background
- **passenger**: búsqueda, detalle viaje, reservar, mis reservas
- **permissions**: notificaciones (expo-notifications), background location
- **external-navigation**: preferencia guardada (Maps / Waze) y uso en flujo de viaje

## Panel web

El panel admin, pricing y billing sigue en el proyecto raíz (Next.js). No se modifica desde esta app; la app móvil solo consume Supabase y, si se configura, las APIs del mismo backend.
