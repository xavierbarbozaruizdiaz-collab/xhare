/**
 * Expo config. EXPO_PUBLIC_* can be set in .env and loaded via dotenv (e.g. babel-plugin-inline-dotenv)
 * or in EAS / local env. They are exposed to the app via extra.
 */
const path = require('path');
const fs = require('fs');

/**
 * Durante `eas build`, EAS mergea `eas.json` → `process.env` antes de evaluar este archivo, pero
 * `dotenv` con `.env.local` (override) podía pisar APP_FLAVOR con `driver` de desarrollo y generar
 * siempre el binario conductor aunque el perfil sea `production_passenger`.
 */
function easBuildContextLikely() {
  const b = String(process.env.EAS_BUILD ?? '').trim().toLowerCase();
  if (b === 'true' || b === '1') return true;
  if (String(process.env.EAS_BUILD_PROFILE ?? '').trim()) return true;
  const argv = process.argv;
  for (let k = 0; k < argv.length; k++) {
    const a = String(argv[k] ?? '');
    if (a === '--profile' || a === '-e' || a.startsWith('--profile=')) return true;
  }
  return false;
}

function loadProjectEnv() {
  require('dotenv').config({ path: path.resolve(__dirname, '.env') });
  const localPath = path.resolve(__dirname, '.env.local');
  if (!fs.existsSync(localPath)) return;
  if (easBuildContextLikely()) {
    const dotenv = require('dotenv');
    const parsed = dotenv.parse(fs.readFileSync(localPath, 'utf8'));
    for (const key of Object.keys(parsed)) {
      if (key === 'APP_FLAVOR' || key === 'EXPO_PUBLIC_APP_FLAVOR') continue;
      const v = parsed[key];
      if (v !== undefined) process.env[key] = String(v);
    }
  } else {
    require('dotenv').config({ path: localPath, override: true });
  }
}

try {
  loadProjectEnv();
} catch (_) {
  // .env optional; use env vars or EAS secrets
}

/** Perfil activo de EAS (`eas build -e …` / `--profile …` / `EAS_BUILD_PROFILE`). */
function resolveEasBuildProfileName() {
  const fromEnv = String(process.env.EAS_BUILD_PROFILE ?? '').trim();
  if (fromEnv) return fromEnv;
  const argv = process.argv;
  for (let k = 0; k < argv.length; k++) {
    const a = String(argv[k] ?? '');
    if (a.startsWith('--profile=')) return a.slice('--profile='.length).trim();
    if (a === '--profile' || a === '-e') {
      const next = String(argv[k + 1] ?? '').trim();
      if (next && !next.startsWith('-')) return next;
    }
  }
  return '';
}

/**
 * Alinea APP_FLAVOR / EXPO_PUBLIC_APP_FLAVOR con `eas.json` para el perfil activo (refuerzo tras `loadProjectEnv`).
 */
function applyFlavorEnvFromEasJsonProfile(profileName) {
  const p = profileName.trim();
  if (!p) return;
  try {
    const easPath = path.join(__dirname, 'eas.json');
    if (!fs.existsSync(easPath)) return;
    const eas = JSON.parse(fs.readFileSync(easPath, 'utf8'));
    const env = eas?.build?.[p]?.env;
    if (!env || typeof env !== 'object') return;
    if (env.APP_FLAVOR != null) process.env.APP_FLAVOR = String(env.APP_FLAVOR);
    if (env.EXPO_PUBLIC_APP_FLAVOR != null) process.env.EXPO_PUBLIC_APP_FLAVOR = String(env.EXPO_PUBLIC_APP_FLAVOR);
  } catch (_) {
    // ignore
  }
}

const activeEasProfile = resolveEasBuildProfileName();
applyFlavorEnvFromEasJsonProfile(activeEasProfile);

/**
 * Flavor de app (pasajero vs conductor).
 * En EAS, las variables del entorno "production" pueden pisar las del perfil en `eas.json`;
 * `EAS_BUILD_PROFILE` / `--profile` + eas.json es la fuente más fiable.
 */
function resolveAppFlavor() {
  const profile = activeEasProfile || String(process.env.EAS_BUILD_PROFILE ?? '').trim();
  if (profile === 'production_driver' || profile === 'preview_driver') return 'driver';
  if (profile === 'production_passenger' || profile === 'preview_passenger') return 'passenger';
  // `production` / `preview` en eas.json llevan APP_FLAVOR pasajero; sin esto, un secret global
  // EXPO_PUBLIC_APP_FLAVOR=driver en Expo podía hacer que todo pareciera "solo conductor".
  if (profile === 'production' || profile === 'preview') return 'passenger';
  const fromEnv =
    String(process.env.APP_FLAVOR ?? '').trim() ||
    String(process.env.EXPO_PUBLIC_APP_FLAVOR ?? '').trim();
  if (fromEnv === 'driver' || fromEnv === 'passenger') return fromEnv;
  return 'passenger';
}

const flavor = resolveAppFlavor();
const isDriver = flavor === 'driver';

module.exports = {
  expo: {
    name: isDriver ? 'Xhare Driver' : 'Xhare',
    slug: 'xhare',
    scheme: 'xhare',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
    },
    extra: {
      eas: {
        projectId: '75522fc5-d54f-4d7f-bdf3-98f5143ed241',
      },
      APP_FLAVOR: flavor,
      EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
      EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL ?? '',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: isDriver ? 'com.xhare.driver' : 'com.xhare.app',
    },
    plugins: ['@react-native-community/datetimepicker'],
    android: {
      adaptiveIcon: {
        // Driver usa un ícono distinto (monochrome) para que el launcher muestre
        // algo diferente, sin requerir assets nuevos.
        backgroundColor: isDriver ? '#E8FFF1' : '#E6F4FE',
        foregroundImage: isDriver
          ? './assets/android-icon-monochrome.png'
          : './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      // Para poder instalar "driver" y "pasajero" simultáneamente en el emulador.
      package: isDriver ? 'com.xhare.driver' : 'com.xhare.app',
      permissions: [
        'ACCESS_COARSE_LOCATION',
        'ACCESS_FINE_LOCATION',
        'ACCESS_BACKGROUND_LOCATION',
        'FOREGROUND_SERVICE',
        'FOREGROUND_SERVICE_LOCATION',
      ],
      // Evita que herramientas intenten abrir placeholders literales (${mainActivityClass}).
      mainActivity: '.MainActivity',
      // Mapa en Reservar (react-native-maps): en Android hace falta API key de Google Maps
      // Crear en Google Cloud Console, activar "Maps SDK for Android", y poner la key en .env o EAS secrets.
      ...(process.env.GOOGLE_MAPS_ANDROID_API_KEY && {
        config: {
          googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY },
        },
      }),
    },
    web: {
      favicon: './assets/favicon.png',
    },
  },
};
