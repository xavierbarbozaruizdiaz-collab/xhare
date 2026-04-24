/**
 * Sincroniza favoritos de Inicio (solo slots fijos) con Supabase para el mapa admin.
 * Usa el cliente Supabase de la sesión (RLS): no depende de EXPO_PUBLIC_API_BASE_URL.
 */
import { supabase, isEnvConfigured } from './supabase';
import { coerceScheduleWeekdayMask, type PassengerFavoriteSnapshot } from '../lib/passengerFavorites';

const FIXED_SLOTS = ['home_to_work', 'work_to_home'] as const;

function hasMapCoords(s: PassengerFavoriteSnapshot): boolean {
  return (
    s.originLat != null &&
    s.originLng != null &&
    s.destinationLat != null &&
    s.destinationLng != null &&
    Number.isFinite(s.originLat) &&
    Number.isFinite(s.originLng) &&
    Number.isFinite(s.destinationLat) &&
    Number.isFinite(s.destinationLng)
  );
}

function isShortcutEnabled(s: PassengerFavoriteSnapshot | undefined): boolean {
  if (!s) return false;
  return s.enabled !== false;
}

function padHm(t: string): string {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return '08:00';
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function validYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

async function resolveAuthUserId(): Promise<string | null> {
  let { data: sessionData } = await supabase.auth.getSession();
  let uid = sessionData.session?.user?.id ?? null;
  if (!uid) {
    await supabase.auth.refreshSession();
    ({ data: sessionData } = await supabase.auth.getSession());
    uid = sessionData.session?.user?.id ?? null;
  }
  if (!uid) {
    const { data: userData } = await supabase.auth.getUser();
    uid = userData.user?.id ?? null;
  }
  return uid;
}

/**
 * Escribe en `passenger_home_map_shortcuts` (migración 065). Requiere tabla y políticas en Supabase.
 */
export async function pushPassengerHomeMapShortcuts(
  store: Partial<Record<string, PassengerFavoriteSnapshot | undefined>>
): Promise<void> {
  if (!isEnvConfigured()) return;

  const userId = await resolveAuthUserId();
  if (!userId) {
    // eslint-disable-next-line no-console
    console.warn('[pushPassengerHomeMapShortcuts] Sin sesión Supabase (getSession/getUser vacío).');
    return;
  }

  for (const slot of FIXED_SLOTS) {
    try {
    const snap = store[slot];
    if (!snap || !isShortcutEnabled(snap) || !hasMapCoords(snap)) {
      await supabase.from('passenger_home_map_shortcuts').delete().eq('user_id', userId).eq('slot', slot);
      continue;
    }

    const rawDate = String(snap.scheduledDateYmd ?? snap.date ?? '').trim();
    const dateYmd = validYmd(rawDate) ? rawDate : new Date().toISOString().slice(0, 10);
    const timeHm = padHm(String(snap.scheduledTimeHm ?? snap.fromTime ?? '08:00').trim() || '08:00');
    const arrivalRaw =
      snap.scheduledArrivalTimeHm != null && snap.scheduledArrivalTimeHm !== ''
        ? String(snap.scheduledArrivalTimeHm).trim()
        : '';
    const scheduledArrivalTime =
      arrivalRaw && /^(\d{1,2}):(\d{2})(?::\d{2})?$/.test(arrivalRaw) ? padHm(arrivalRaw) : null;
    const scheduleDaily = Boolean(snap.scheduleDaily);
    const rawMask = coerceScheduleWeekdayMask(snap.scheduleWeekdayMask);
    const scheduleWeekdayMask = scheduleDaily && rawMask === 0 ? 127 : rawMask;

    const row = {
      user_id: userId,
      slot,
      enabled: true,
      origin_label: String(snap.origin ?? '').trim() || null,
      destination_label: String(snap.destination ?? '').trim() || null,
      origin_lat: Number(snap.originLat),
      origin_lng: Number(snap.originLng),
      destination_lat: Number(snap.destinationLat),
      destination_lng: Number(snap.destinationLng),
      scheduled_date: dateYmd,
      scheduled_time: timeHm,
      scheduled_arrival_time: scheduledArrivalTime,
      schedule_daily: scheduleDaily,
      schedule_weekday_mask: scheduleWeekdayMask,
      updated_at: new Date().toISOString(),
    };

    let { error } = await supabase.from('passenger_home_map_shortcuts').upsert(row, { onConflict: 'user_id,slot' });
    if (error) {
      const del = await supabase.from('passenger_home_map_shortcuts').delete().eq('user_id', userId).eq('slot', slot);
      if (!del.error) {
        ({ error } = await supabase.from('passenger_home_map_shortcuts').insert(row));
      }
    }
    if (error) {
      // eslint-disable-next-line no-console
      console.warn('[pushPassengerHomeMapShortcuts]', slot, error.message, error.code ?? '');
    }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[pushPassengerHomeMapShortcuts] slot', slot, e instanceof Error ? e.message : e);
    }
  }
}
