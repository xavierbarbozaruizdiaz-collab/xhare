import type { SupabaseClient } from '@supabase/supabase-js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH = 100;

type ExpoMessage = {
  to: string;
  sound: 'default';
  title: string;
  body: string;
  data: { rideId: string; groupId: string; type: 'demand_passenger_left' };
};

/**
 * Avisa al conductor (viaje draft / awaiting_driver) que un pasajero salió del grupo de demanda.
 * No lanza: errores solo en consola.
 */
export async function sendDriverDemandPassengerLeftPush(
  service: SupabaseClient,
  entries: Array<{ ride_id: string; group_id: string }>
): Promise<void> {
  const uniq = new Map<string, { ride_id: string; group_id: string }>();
  for (const e of entries) {
    const rid = String(e.ride_id ?? '').trim();
    if (!rid) continue;
    uniq.set(rid, { ride_id: rid, group_id: String(e.group_id ?? '').trim() });
  }
  if (uniq.size === 0) return;

  const rideIds = Array.from(uniq.keys());
  const { data: rides, error: rErr } = await service
    .from('rides')
    .select('id, driver_id')
    .in('id', rideIds)
    .in('status', ['awaiting_driver', 'draft']);

  if (rErr || !rides?.length) return;

  const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
  const title = 'Demanda: pasajero salió del grupo';
  const body =
    'Un pasajero dejó de figurar en un grupo vinculado a tu viaje en despacho. Revisá cupos y paradas.';

  for (const row of rides) {
    const rideId = String((row as { id: string }).id);
    const driverId = String((row as { driver_id?: string | null }).driver_id ?? '').trim();
    const groupId = uniq.get(rideId)?.group_id ?? '';
    if (!driverId) continue;

    const { data: tokRows, error: tErr } = await service
      .from('push_tokens')
      .select('token')
      .eq('user_id', driverId);
    if (tErr || !tokRows?.length) continue;

    const tokens = Array.from(
      new Set(
        tokRows
          .map((r) => r.token)
          .filter((t): t is string => typeof t === 'string' && t.startsWith('ExponentPushToken'))
      )
    );
    if (!tokens.length) continue;

    const messages: ExpoMessage[] = tokens.map((to) => ({
      to,
      sound: 'default',
      title,
      body,
      data: { rideId, groupId, type: 'demand_passenger_left' },
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
          console.error('[sendDriverDemandPassengerLeftPush] Expo HTTP', res.status, text);
        }
      } catch (e) {
        console.error('[sendDriverDemandPassengerLeftPush] Expo fetch', e);
      }
    }
  }
}
