/**
 * Update ride status (en_route, completed) via Supabase Edge Function.
 * Same contract as web app.
 */
import { env } from '../core/env';

export type RideStatusUpdate = 'en_route' | 'completed';

export async function updateRideStatus(
  rideId: string,
  status: RideStatusUpdate,
  accessToken: string
): Promise<{ ok: boolean; error?: string; details?: string }> {
  const url = `${env.supabaseUrl}/functions/v1/ride-update-status`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ ride_id: rideId, status }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) return { ok: false, error: 'unauthorized' };
  if (!res.ok)
    return {
      ok: false,
      error: data?.error ?? 'unknown',
      details: data?.details,
    };
  return { ok: data?.ok !== false };
}
