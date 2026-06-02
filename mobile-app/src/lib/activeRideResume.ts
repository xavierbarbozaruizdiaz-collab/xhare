import { supabase } from '../backend/supabase';
import { getAppFlavor } from '../core/flavor';
import { fetchMyRides, findPassengerActiveRideShortcut } from '../rides/api';

/** Viaje `en_route` del conductor (misma fuente que Inicio → “Ir al viaje en curso”). */
export async function findDriverActiveEnRouteRideId(driverId: string): Promise<string | null> {
  const uid = String(driverId ?? '').trim();
  if (!uid) return null;
  try {
    const rides = await fetchMyRides(uid);
    const enRoute = rides.find((r) => String((r as { status?: unknown }).status ?? '') === 'en_route');
    const id = enRoute ? String((enRoute as { id?: unknown }).id ?? '').trim() : '';
    if (id) return id;
  } catch {
    // fallback abajo
  }
  const { data, error } = await supabase
    .from('rides')
    .select('id, updated_at')
    .eq('driver_id', uid)
    .eq('status', 'en_route')
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error || !data?.length) return null;
  const fallbackId = String(data[0]?.id ?? '').trim();
  return fallbackId || null;
}

/** Viaje en curso relevante para el usuario actual (conductor o pasajero). */
export async function findActiveEnRouteRideIdForUser(userId: string): Promise<string | null> {
  const uid = String(userId ?? '').trim();
  if (!uid) return null;
  if (getAppFlavor() === 'passenger') {
    return findPassengerActiveRideShortcut({ userId: uid });
  }
  return findDriverActiveEnRouteRideId(uid);
}
