/**
 * Send driver location for ride in progress. Calls Next.js API.
 * Only used when apiBaseUrl is set (e.g. EXPO_PUBLIC_API_BASE_URL).
 */
import { env } from '../core/env';

export async function sendRideLocation(
  rideId: string,
  lat: number,
  lng: number,
  accessToken: string
): Promise<boolean> {
  const base = env.apiBaseUrl?.trim();
  if (!base) return false;
  const url = `${base.replace(/\/$/, '')}/api/rides/${rideId}/location`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ lat, lng }),
  });
  return res.ok;
}
