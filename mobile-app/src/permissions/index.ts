/**
 * Permissions module: location, notifications (and background when needed).
 * First-class citizen: request and check before critical flows.
 */
import * as Location from 'expo-location';

export type LocationPermissionStatus = 'granted' | 'denied' | 'undetermined';

export async function getLocationPermissionStatus(): Promise<LocationPermissionStatus> {
  const { status } = await Location.getForegroundPermissionsAsync();
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

export async function requestLocationPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

/**
 * For driver ride tracking: background location.
 * Call when starting "en route"; handle denied gracefully.
 */
export async function requestBackgroundLocationPermission(): Promise<boolean> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status !== 'granted') return false;
  const { status } = await Location.requestBackgroundPermissionsAsync();
  return status === 'granted';
}

// Notifications: add expo-notifications when implementing push
// export async function requestNotificationPermission(): Promise<boolean> { ... }
