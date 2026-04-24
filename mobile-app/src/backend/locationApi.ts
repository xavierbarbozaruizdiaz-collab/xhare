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
  const payload = JSON.stringify({ lat, lng });

  const sendOnce = async (): Promise<boolean> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9_000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: payload,
        signal: controller.signal,
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  };

  const first = await sendOnce();
  if (first) return true;
  return sendOnce();
}
