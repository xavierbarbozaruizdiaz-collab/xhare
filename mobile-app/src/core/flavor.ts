import Constants from 'expo-constants';

export type AppFlavor = 'driver' | 'passenger';

export function getAppFlavor(): AppFlavor {
  const raw = (Constants.expoConfig?.extra as any)?.APP_FLAVOR;
  return raw === 'driver' ? 'driver' : 'passenger';
}

