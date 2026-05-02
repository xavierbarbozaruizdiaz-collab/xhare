import Constants from 'expo-constants';
import { Platform } from 'react-native';
import * as Application from 'expo-application';

export type AppFlavor = 'driver' | 'passenger';

/**
 * Sabor por binario instalado (Android applicationId / iOS bundle id).
 * Con Metro en dev, `Constants.expoConfig.extra` puede reflejar un solo `app.config`
 * del proceso del packager; el id nativo es la fuente de verdad para pasajero vs conductor.
 */
function flavorFromNativeApplicationId(): AppFlavor | null {
  const id = (Application.applicationId ?? '').trim();
  if (id === 'com.xhare.driver') return 'driver';
  if (id === 'com.xhare.app') return 'passenger';
  return null;
}

export function getAppFlavor(): AppFlavor {
  if (Platform.OS === 'android' || Platform.OS === 'ios') {
    const fromNative = flavorFromNativeApplicationId();
    if (fromNative) return fromNative;
  }
  const raw = (Constants.expoConfig?.extra as any)?.APP_FLAVOR;
  return raw === 'driver' ? 'driver' : 'passenger';
}
