import { distanceMeters, type Point } from './geo';

export const BOOKING_STOP_LINK_MAX_M = 1800;

export function nearestRideStopIdForBookingPoint(
  stops: Array<{ id: string; lat: number; lng: number }>,
  lat: number,
  lng: number,
  maxMeters: number = BOOKING_STOP_LINK_MAX_M
): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || stops.length === 0) return null;
  const p: Point = { lat, lng };
  let best: { id: string; d: number } | null = null;
  for (const s of stops) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
    const d = distanceMeters(p, { lat: s.lat, lng: s.lng });
    if (d <= maxMeters && (!best || d < best.d)) best = { id: s.id, d };
  }
  return best?.id ?? null;
}
