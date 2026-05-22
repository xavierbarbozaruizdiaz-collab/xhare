import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchExpoTokensForUsers, sendExpoPushMessages } from './expoPush';

/**
 * Notifica a pasajeros con reserva activa que el conductor inició el trayecto.
 * Idempotente si `rides.en_route_push_sent_at` ya está seteado.
 */
export async function sendPassengersRideEnRoutePush(
  service: SupabaseClient,
  rideId: string
): Promise<boolean> {
  const { data: ride, error: rideErr } = await service
    .from('rides')
    .select('id, status, en_route_push_sent_at')
    .eq('id', rideId)
    .maybeSingle();

  if (rideErr || !ride || ride.status !== 'en_route') return false;
  if (ride.en_route_push_sent_at) return false;

  const { data: bookings, error: bErr } = await service
    .from('bookings')
    .select('passenger_id')
    .eq('ride_id', rideId)
    .neq('status', 'cancelled');

  if (bErr || !bookings?.length) return false;

  const userIds = Array.from(new Set(bookings.map((b) => b.passenger_id)));
  const tokens = await fetchExpoTokensForUsers(service, userIds);
  if (!tokens.length) return false;

  const title = 'El minibús inició el trayecto';
  const body = 'Tu viaje ya está en marcha. Abrí la app para seguir al conductor en el mapa.';

  await sendExpoPushMessages(
    tokens.map((to) => ({
      to,
      sound: 'default',
      title,
      body,
      data: { rideId, type: 'ride_en_route' },
    }))
  );

  await service
    .from('rides')
    .update({ en_route_push_sent_at: new Date().toISOString() })
    .eq('id', rideId);

  return true;
}
