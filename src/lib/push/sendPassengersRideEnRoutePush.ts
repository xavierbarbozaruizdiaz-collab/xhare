import type { SupabaseClient } from '@supabase/supabase-js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo permite hasta 100 mensajes por request. */
const EXPO_BATCH = 100;

type ExpoMessage = {
  to: string;
  sound: 'default';
  title: string;
  body: string;
  data: { rideId: string; type: 'ride_en_route' };
};

/**
 * Notifica a pasajeros con reserva activa que el conductor inició el viaje.
 * Usa tokens en `push_tokens` (cliente Expo). Fallos se loguean; no lanzan.
 */
export async function sendPassengersRideEnRoutePush(
  service: SupabaseClient,
  rideId: string
): Promise<void> {
  const { data: bookings, error: bErr } = await service
    .from('bookings')
    .select('passenger_id')
    .eq('ride_id', rideId)
    .neq('status', 'cancelled');

  if (bErr || !bookings?.length) return;

  const userIds = Array.from(new Set(bookings.map((b) => b.passenger_id)));

  const { data: rows, error: tErr } = await service
    .from('push_tokens')
    .select('token')
    .in('user_id', userIds);

  if (tErr || !rows?.length) return;

  const tokens = Array.from(
    new Set(
      rows
        .map((r) => r.token)
        .filter((t): t is string => typeof t === 'string' && t.startsWith('ExponentPushToken'))
    )
  );

  if (!tokens.length) return;

  const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
  const title = 'El viaje comenzó';
  const body = 'El conductor inició el recorrido. Podés seguirlo en el mapa.';

  const messages: ExpoMessage[] = tokens.map((to) => ({
    to,
    sound: 'default',
    title,
    body,
    data: { rideId, type: 'ride_en_route' },
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
        console.error('[sendPassengersRideEnRoutePush] Expo HTTP', res.status, text);
      }
    } catch (e) {
      console.error('[sendPassengersRideEnRoutePush] Expo fetch', e);
    }
  }
}
