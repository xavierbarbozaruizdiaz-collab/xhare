import AsyncStorage from '@react-native-async-storage/async-storage';

const ANCHOR_KEY = '@xhare/driver_arrive_anchor_v1';
const ALERTED_STOP_KEY = '@xhare/driver_arrive_alerted_stop';
const FOREGROUND_RIDE_KEY = '@xhare/driver_detail_foreground_ride';

export type DriverArriveAnchor = {
  rideId: string;
  lat: number;
  lng: number;
  stopKey: string;
  label?: string;
};

export function buildDriverVisitStopKey(
  rideId: string,
  row: { kind: string; bookingId?: string; rideStopId?: string; stopOrder?: number }
): string {
  return `${rideId}|${row.kind}|${row.bookingId ?? ''}|${row.rideStopId ?? ''}|${row.stopOrder ?? ''}`;
}

export async function syncDriverArriveAnchorStorage(anchor: DriverArriveAnchor): Promise<void> {
  const prevRaw = await AsyncStorage.getItem(ANCHOR_KEY);
  let prevStopKey: string | null = null;
  if (prevRaw) {
    try {
      const prev = JSON.parse(prevRaw) as { stopKey?: string };
      prevStopKey = prev.stopKey ?? null;
    } catch {
      prevStopKey = null;
    }
  }
  await AsyncStorage.setItem(ANCHOR_KEY, JSON.stringify(anchor));
  if (prevStopKey !== anchor.stopKey) {
    await AsyncStorage.removeItem(ALERTED_STOP_KEY);
  }
}

export async function readDriverArriveAnchorStorage(): Promise<DriverArriveAnchor | null> {
  const raw = await AsyncStorage.getItem(ANCHOR_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DriverArriveAnchor;
    if (!parsed?.rideId || !Number.isFinite(parsed.lat) || !Number.isFinite(parsed.lng)) return null;
    if (!parsed.stopKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearDriverArriveAnchorStorage(): Promise<void> {
  await AsyncStorage.multiRemove([ANCHOR_KEY, ALERTED_STOP_KEY]);
}

export async function getDriverArriveAlertedStopKey(): Promise<string | null> {
  const v = (await AsyncStorage.getItem(ALERTED_STOP_KEY))?.trim();
  return v || null;
}

export async function markDriverArriveAlertedStopKey(stopKey: string): Promise<void> {
  await AsyncStorage.setItem(ALERTED_STOP_KEY, stopKey);
}

export async function setDriverDetailForegroundRide(rideId: string | null): Promise<void> {
  if (rideId?.trim()) {
    await AsyncStorage.setItem(FOREGROUND_RIDE_KEY, rideId.trim());
  } else {
    await AsyncStorage.removeItem(FOREGROUND_RIDE_KEY);
  }
}

export async function getDriverDetailForegroundRide(): Promise<string | null> {
  const v = (await AsyncStorage.getItem(FOREGROUND_RIDE_KEY))?.trim();
  return v || null;
}
