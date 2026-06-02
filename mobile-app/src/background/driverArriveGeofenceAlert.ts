import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { distanceMeters } from '../lib/geo';
import { ARRIVE_GATE_M } from '../lib/rideArriveVisit';
import {
  getDriverArriveAlertedStopKey,
  getDriverDetailForegroundRide,
  markDriverArriveAlertedStopKey,
  readDriverArriveAnchorStorage,
  type DriverArriveAnchor,
} from './driverArriveAnchorStorage';

const ARRIVE_CHANNEL_ID = 'driver_arrive_gate';

let channelReady = false;

/** Canal Android de alta prioridad para avisar cerca del punto (sobre Waze/Maps). */
export async function ensureArriveGateNotificationReady(): Promise<void> {
  if (channelReady) return;
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing !== 'granted') {
      await Notifications.requestPermissionsAsync();
    }
  } catch {
    /* permiso opcional; la notificación puede fallar sin bloquear tracking */
  }
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ARRIVE_CHANNEL_ID, {
      name: 'Llegada al punto',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 200, 120, 200],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      sound: 'default',
      enableVibrate: true,
    });
  }
  channelReady = true;
}

async function openDriverAppForRide(rideId: string): Promise<void> {
  const url = Linking.createURL(`ride/${encodeURIComponent(rideId)}`);
  try {
    await Linking.openURL(url);
  } catch {
    /* La notificación sigue siendo el fallback */
  }
}

async function showArriveGateNotification(rideId: string, label?: string): Promise<void> {
  await ensureArriveGateNotificationReady();
  const deepLink = Linking.createURL(`ride/${encodeURIComponent(rideId)}`);
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Estás en el punto',
      body: label
        ? `${label} — Confirmá Llegué en ÑandeBus`
        : 'Confirmá Llegué en ÑandeBus Driver',
      data: { rideId, url: deepLink },
      sound: 'default',
      priority: Platform.OS === 'android' ? Notifications.AndroidNotificationPriority.MAX : undefined,
      ...(Platform.OS === 'android' ? { channelId: ARRIVE_CHANNEL_ID } : {}),
    },
    trigger: null,
  });
}

/**
 * En segundo plano: si el conductor entra en rango de Llegué, trae la app al frente (Android)
 * y muestra aviso de alta prioridad. Una vez por parada del recorrido.
 */
export async function maybeAlertDriverArriveGeofence(
  activeTrackingRideId: string,
  driverLat: number,
  driverLng: number
): Promise<void> {
  const anchor = await readDriverArriveAnchorStorage();
  if (!anchor || anchor.rideId !== activeTrackingRideId) return;

  const d = distanceMeters({ lat: driverLat, lng: driverLng }, { lat: anchor.lat, lng: anchor.lng });
  if (!Number.isFinite(d) || d > ARRIVE_GATE_M) return;

  const alerted = await getDriverArriveAlertedStopKey();
  if (alerted === anchor.stopKey) return;

  const foregroundRide = await getDriverDetailForegroundRide();
  if (foregroundRide === activeTrackingRideId) return;

  await markDriverArriveAlertedStopKey(anchor.stopKey);

  if (Platform.OS === 'android') {
    await openDriverAppForRide(activeTrackingRideId);
  }
  await showArriveGateNotification(activeTrackingRideId, anchor.label);
}

export function isNearArriveAnchor(
  driverLat: number,
  driverLng: number,
  anchor: DriverArriveAnchor
): boolean {
  const d = distanceMeters({ lat: driverLat, lng: driverLng }, { lat: anchor.lat, lng: anchor.lng });
  return Number.isFinite(d) && d <= ARRIVE_GATE_M;
}
