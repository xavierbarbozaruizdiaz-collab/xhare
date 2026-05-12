import { Linking, Platform } from 'react-native';

export type NavAppAvailability = {
  google_maps: boolean;
  waze: boolean;
  browser: true;
};

/**
 * Detecta si las apps de navegación están instaladas (para deshabilitar opciones en Ajustes).
 * Android 11+: requiere `<queries>` en el manifest (expo-build-properties en app.config.js).
 */
export async function getNavAppAvailability(): Promise<NavAppAvailability> {
  const browser = true as const;
  if (Platform.OS === 'web') {
    return { google_maps: true, waze: true, browser };
  }
  if (Platform.OS === 'ios') {
    const waze = await Linking.canOpenURL('waze://');
    const google =
      (await Linking.canOpenURL('comgooglemaps://')) || (await Linking.canOpenURL('googlemaps://'));
    return { google_maps: google, waze, browser };
  }
  if (Platform.OS === 'android') {
    const waze = await Linking.canOpenURL('waze://');
    const googleNav = await Linking.canOpenURL('google.navigation:q=0,0');
    return { google_maps: googleNav, waze, browser };
  }
  return { google_maps: true, waze: true, browser };
}
