import { env } from '../core/env';

/** URL pública (web Next) para que contactos vean el estado del viaje sin login. */
export function getSharedTripTrackingUrl(shareCode: string, bookingId?: string): string | null {
  const base = env.apiBaseUrl.trim().replace(/\/+$/, '');
  const code = String(shareCode ?? '').trim();
  if (!base || !code) return null;
  const normalized = code.toUpperCase().replace(/\s+/g, '');
  const bid = String(bookingId ?? '').trim();
  const q = bid ? `?b=${encodeURIComponent(bid)}` : '';
  return `${base}/viaje/compartido/${encodeURIComponent(normalized)}${q}`;
}
