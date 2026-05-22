import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { requestBackgroundLocationPermission } from '../permissions';
import { TRACK_DRIVER_LOCATION_TASK } from './driverLocationTask';

const TRACKING_RIDE_ID_KEY = '@xhare/tracking_ride_id';
const LAST_SENT_AT_MS_KEY = '@xhare/tracking_last_sent_ms';

export async function isDriverTrackingActive(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(TRACK_DRIVER_LOCATION_TASK);
  } catch {
    return false;
  }
}

export async function startDriverTrackingInBackground(rideId: string): Promise<boolean> {
  try {
    const id = rideId.trim();
    if (!id) return false;
    const granted = await requestBackgroundLocationPermission();
    if (!granted) return false;

    const prevRideId = (await AsyncStorage.getItem(TRACKING_RIDE_ID_KEY))?.trim() ?? '';
    await AsyncStorage.setItem(TRACKING_RIDE_ID_KEY, id);
    await AsyncStorage.removeItem(LAST_SENT_AT_MS_KEY);

    const already = await isDriverTrackingActive();
    if (already && prevRideId && prevRideId !== id) {
      await Location.stopLocationUpdatesAsync(TRACK_DRIVER_LOCATION_TASK);
    } else if (already) {
      return true;
    }

    await Location.startLocationUpdatesAsync(TRACK_DRIVER_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 5_000,
      distanceInterval: 5,
      pausesUpdatesAutomatically: false,
      // Android foreground service obligatorio para sostener tracking con Waze/Maps abiertos.
      foregroundService: {
        notificationTitle: 'ÑandeBus Driver: Viaje en curso',
        notificationBody: 'Transmitiendo ubicacion',
        killServiceOnDestroy: false,
      },
    });
    return await isDriverTrackingActive();
  } catch (e) {
    console.warn('[tracking] start background tracking failed', e);
    return false;
  }
}

export async function stopDriverTrackingInBackground(): Promise<void> {
  try {
    const active = await isDriverTrackingActive();
    if (active) {
      await Location.stopLocationUpdatesAsync(TRACK_DRIVER_LOCATION_TASK);
    }
  } catch {
    // ignore
  } finally {
    await AsyncStorage.removeItem(TRACKING_RIDE_ID_KEY);
    await AsyncStorage.removeItem(LAST_SENT_AT_MS_KEY);
  }
}

