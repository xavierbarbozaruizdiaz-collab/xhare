import type { SupabaseClient } from '@supabase/supabase-js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH = 100;

type ExpoMessage = {
  to: string;
  sound: 'default';
  title: string;
  body: string;
  data: { rideId: string; type: 'ride_cancelled' };
};

/**
 * Notifica cancelación de viaje a pasajeros impactados:
 * - reservas activas del ride
 * - solicitudes aceptadas/vinculadas al ride (flujo de grupo/sistema)
 */
export async function sendPassengersRideCancelledPush(
  service: SupabaseClient,
  rideId: string
): Promise<void> {
  const userIds = new Set<string>();

  const { data: bookings } = await service
    .from('bookings')
    .select('passenger_id')
    .eq('ride_id', rideId)
    .neq('status', 'cancelled');

  (bookings ?? []).forEach((b) => {
    const id = String((b as { passenger_id?: unknown }).passenger_id ?? '').trim();
    if (id) userIds.add(id);
  });

  const { data: trips } = await service
    .from('trip_requests')
    .select('user_id, status')
    .eq('ride_id', rideId)
    .in('status', ['accepted', 'grouped', 'group_linked_pending']);

  (trips ?? []).forEach((t) => {
    const id = String((t as { user_id?: unknown }).user_id ?? '').trim();
    if (id) userIds.add(id);
  });

  if (userIds.size === 0) return;

  const { data: rows } = await service
    .from('push_tokens')
    .select('token')
    .in('user_id', Array.from(userIds));

  const tokens = Array.from(
    new Set(
      (rows ?? [])
        .map((r) => (r as { token?: unknown }).token)
        .filter((t): t is string => typeof t === 'string' && t.startsWith('ExponentPushToken'))
    )
  );
  if (!tokens.length) return;

  const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
  const title = 'Viaje cancelado';
  const body = 'El viaje fue cancelado por el conductor. Volvé a intentarlo desde Favoritos o Buscar viaje.';

  const messages: ExpoMessage[] = tokens.map((to) => ({
    to,
    sound: 'default',
    title,
    body,
    data: { rideId, type: 'ride_cancelled' },
  }));

  for (let i = 0; i < messages.length; i += EXPO_BATCH) {
    const chunk = messages.slice(i, i + EXPO_BATCH);
    const payload = chunk.length === 1 ? chunk[0] : chunk;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error('[sendPassengersRideCancelledPush] Expo HTTP', res.status, text);
      }
    } catch (e) {
      console.error('[sendPassengersRideCancelledPush] Expo fetch', e);
    }
  }
}

