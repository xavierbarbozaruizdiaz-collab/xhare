import { Platform } from 'react-native';
import { PROVIDER_GOOGLE } from 'react-native-maps';

/** Android: usar Google Maps explícitamente (requiere `com.google.android.geo.API_KEY` en el manifest). */
export const androidMapProvider = Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined;
