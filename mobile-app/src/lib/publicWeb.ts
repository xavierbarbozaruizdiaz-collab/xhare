import { env } from '../core/env';

/** URL pública (web Next) para que contactos vean el estado del viaje sin login. */
export function getSharedTripTrackingUrl(shareCode: string): string | null {
  const base = env.apiBaseUrl.trim().replace(/\/+$/, '');
  const code = String(shareCode ?? '').trim();
  if (!base || !code) return null;
  const normalized = code.toUpperCase().replace(/\s+/g, '');
  return `${base}/viaje/compartido/${encodeURIComponent(normalized)}`;
}
