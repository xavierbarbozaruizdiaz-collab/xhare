import type { SupabaseClient } from '@supabase/supabase-js';
import { distanceMeters } from '@/lib/geo';
import { fetchExpoTokensForUsers, sendExpoPushMessages } from './expoPush';

/** Distancia máxima conductor → subida para avisar al pasajero (una vez por reserva). */
export const PICKUP_APPROACH_MAX_METERS = 750;

/** Mínimo para no disparar si el conductor ya está en el punto (0–30 m). */
export const PICKUP_APPROACH_MIN_METERS = 40;

/**
 * Tras actualizar ubicación del conductor: notifica pasajeros cuya subida está cerca
 * y aún no subieron al minibús.
 */
export async function trySendPickupApproachPush(
  service: SupabaseClient,
  rideId: string,
  driverLat: number,
  driverLng: number
): Promise<void> {
  const driverPoint = { lat: driverLat, lng: driverLng };

  const { data: bookings, error: bErr } = await service
    .from('bookings')
    .select('id, passenger_id, pickup_lat, pickup_lng, pickup_approach_push_sent_at')
    .eq('ride_id', rideId)
    .neq('status', 'cancelled')
    .is('pickup_approach_push_sent_at', null);

  if (bErr || !bookings?.length) return;

  const bookingIds = bookings.map((b) => b.id);
  const { data: boarded } = await service
    .from('ride_boarding_events')
    .select('booking_id')
    .eq('ride_id', rideId)
    .in('booking_id', bookingIds)
    .eq('event_type', 'boarded');

  const boardedIds = new Set((boarded ?? []).map((e) => String(e.booking_id)));

  const toNotify: Array<{ bookingId: string; passengerId: string }> = [];

  for (const b of bookings) {
    if (boardedIds.has(String(b.id))) continue;
    const lat = Number(b.pickup_lat);
    const lng = Number(b.pickup_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const d = distanceMeters(driverPoint, { lat, lng });
    if (d < PICKUP_APPROACH_MIN_METERS || d > PICKUP_APPROACH_MAX_METERS) continue;
    toNotify.push({ bookingId: String(b.id), passengerId: String(b.passenger_id) });
  }

  if (!toNotify.length) return;

  const userIds = Array.from(new Set(toNotify.map((x) => x.passengerId)));
  const tokens = await fetchExpoTokensForUsers(service, userIds);
  if (!tokens.length) return;

  const title = 'El minibús va hacia tu subida';
  const body = 'El conductor está cerca de tu punto de subida. Abrí la app para verlo en el mapa.';

  const tokenByUser = new Map<string, string[]>();
  const { data: tokenRows } = await service
    .from('push_tokens')
    .select('user_id, token')
    .in('user_id', userIds);
  for (const row of tokenRows ?? []) {
    const uid = String(row.user_id);
    const tok = row.token;
    if (typeof tok !== 'string' || !tok.startsWith('ExponentPushToken')) continue;
    const list = tokenByUser.get(uid) ?? [];
    list.push(tok);
    tokenByUser.set(uid, list);
  }

  const messages = [];
  for (const item of toNotify) {
    const userTokens = tokenByUser.get(item.passengerId) ?? [];
    for (const to of userTokens) {
      messages.push({
        to,
        sound: 'default' as const,
        title,
        body,
        data: { rideId, type: 'ride_pickup_approach', bookingId: item.bookingId },
      });
    }
  }

  if (!messages.length) return;

  await sendExpoPushMessages(messages);

  const now = new Date().toISOString();
  for (const item of toNotify) {
    await service
      .from('bookings')
      .update({ pickup_approach_push_sent_at: now })
      .eq('id', item.bookingId);
  }
}
