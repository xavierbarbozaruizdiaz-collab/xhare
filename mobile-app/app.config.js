/**
 * Expo config. EXPO_PUBLIC_* can be set in .env and loaded via dotenv (e.g. babel-plugin-inline-dotenv)
 * or in EAS / local env. They are exposed to the app via extra.
 */
const path = require('path');
try {
  require('dotenv').config({ path: path.resolve(__dirname, '.env') });
} catch (_) {
  // .env optional; use env vars or EAS secrets
}

const flavor = process.env.APP_FLAVOR || process.env.EXPO_PUBLIC_APP_FLAVOR || 'passenger';
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
