import { Platform } from 'react-native';
import { requireNativeModule } from 'expo';

export type XhareNavigationNative = {
  openViewUriInPackage: (uri: string, packageName: string) => Promise<boolean>;
  isPackageInstalled: (packageName: string) => Promise<boolean>;
};

let cached: XhareNavigationNative | null | undefined;

/**
 * Módulo nativo local `xhare-navigation`: Intent ACTION_VIEW + setPackage (Android)
 * y comprobación de instalación vía PackageManager / canOpenURL (iOS).
 */
export function getXhareNavigationNative(): XhareNavigationNative | null {
  if (Platform.OS === 'web') return null;
  if (cached === null) return null;
  if (cached !== undefined) return cached;
  try {
    const m = requireNativeModule<XhareNavigationNative>('XhareNavigation');
    if (typeof m?.openViewUriInPackage !== 'function') {
      cached = null;
      return null;
    }
    cached = m;
    return cached;
  } catch {
    cached = null;
    return null;
  }
}
