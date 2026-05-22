import { supabase } from '../backend/supabase';
import { getAppFlavor } from '../core/flavor';
import { findPassengerActiveRideShortcut } from '../rides/api';

/** Viaje `en_route` del conductor (como máximo uno activo por reglas de negocio). */
export async function findDriverActiveEnRouteRideId(driverId: string): Promise<string | null> {
  const uid = String(driverId ?? '').trim();
  if (!uid) return null;
  const { data, error } = await supabase
    .from('rides')
    .select('id, updated_at')
    .eq('driver_id', uid)
    .eq('status', 'en_route')
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error || !data?.length) return null;
  const id = String(data[0]?.id ?? '').trim();
  return id || null;
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
