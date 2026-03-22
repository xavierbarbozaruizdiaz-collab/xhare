# Checklist antes de generar una nueva APK release (LOCAL)

Ejecutá estos pasos desde la carpeta `mobile-app` antes de correr el **flujo oficial** de APK release local para evitar fallos.

## 1. Verificar TypeScript

```bash
npm run check
```

o directamente:

```bash
npx tsc --noEmit
```

Si hay errores, corregilos antes de hacer el build.

## 2. Verificar dependencias

```bash
npm install
npm ls --depth=0
```

Asegurate de que no haya dependencias rotas o faltantes.

## 3. Variables de entorno (local)

- En `mobile-app/.env` deben estar `EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
- Recomendado: `EXPO_PUBLIC_API_BASE_URL` para pricing por tramo y features asociadas.

## 4. Assets requeridos por app.config.js

En `assets/` deben existir:

- `icon.png`
- `splash-icon.png`
- `favicon.png`
- `android-icon-foreground.png`
- `android-icon-background.png`
- `android-icon-monochrome.png`

## 5. Generar el APK

```bash
npm run build:android:release
```

El archivo queda en:

`android/app/build/outputs/apk/release/app-release.apk`

---

**Resumen rápido:** `npm run check` y `npm install` antes de cada `npm run build:android:release`.
