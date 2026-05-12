import { Linking, Platform } from 'react-native';
import { ANDROID_GOOGLE_MAPS_PKG, ANDROID_WAZE_PKG } from './constants';
import { getXhareNavigationNative } from './navNative';

export type NavAppAvailability = {
  google_maps: boolean;
  waze: boolean;
  browser: true;
};

/**
 * Apps de navegación instaladas (Ajustes: deshabilitar opciones sin app).
 * Prioriza el módulo nativo `xhare-navigation` (PackageManager en Android).
 */
export async function getNavAppAvailability(): Promise<NavAppAvailability> {
  const browser = true as const;
  if (Platform.OS === 'web') {
    return { google_maps: true, waze: true, browser };
  }

  const mod = getXhareNavigationNative();
  if (mod != null && typeof mod.isPackageInstalled === 'function') {
    try {
      const waze = await mod.isPackageInstalled(ANDROID_WAZE_PKG);
      const google = await mod.isPackageInstalled(ANDROID_GOOGLE_MAPS_PKG);
      return { google_maps: google, waze, browser };
    } catch {
      /* continuar con fallback */
    }
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
