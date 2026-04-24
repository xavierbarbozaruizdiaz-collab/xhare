import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { sendRideLocation } from '../backend/locationApi';
import { supabase } from '../backend/supabase';

export const TRACK_DRIVER_LOCATION_TASK = 'TRACK_DRIVER_LOCATION';
const TRACKING_RIDE_ID_KEY = '@xhare/tracking_ride_id';
const LAST_SENT_AT_MS_KEY = '@xhare/tracking_last_sent_ms';
const MIN_SEND_GAP_MS = 9_000;

async function readActiveRideId(): Promise<string | null> {
  const id = (await AsyncStorage.getItem(TRACKING_RIDE_ID_KEY))?.trim();
  return id ? id : null;
}

async function shouldSendNow(nowMs: number): Promise<boolean> {
  const lastRaw = await AsyncStorage.getItem(LAST_SENT_AT_MS_KEY);
  const lastMs = Number(lastRaw ?? 0);
  if (!Number.isFinite(lastMs) || lastMs <= 0) return true;
  return nowMs - lastMs >= MIN_SEND_GAP_MS;
}

async function markSent(nowMs: number): Promise<void> {
  await AsyncStorage.setItem(LAST_SENT_AT_MS_KEY, String(nowMs));
}

if (!(TaskManager as unknown as { isTaskDefined?: (name: string) => boolean }).isTaskDefined?.(TRACK_DRIVER_LOCATION_TASK)) {
  TaskManager.defineTask(TRACK_DRIVER_LOCATION_TASK, async ({ data, error }) => {
    if (error) return;
    const rideId = await readActiveRideId();
    if (!rideId) return;

    const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations ?? [];
    const last = locations[locations.length - 1];
    if (!last?.coords) return;

    const nowMs = Date.now();
    if (!(await shouldSendNow(nowMs))) return;

    const { data: auth } = await supabase.auth.getSession();
    const token = auth.session?.access_token?.trim();
    if (!token) return;

    const ok = await sendRideLocation(
      rideId,
      Number(last.coords.latitude),
      Number(last.coords.longitude),
      token
    );
    if (ok) await markSent(nowMs);
  });
}

