import type { Point } from './geo';

const MAX_AGE_MS = 3 * 60 * 1000;

export type PassengerLiveLocationFields = {
  passenger_lat?: unknown;
  passenger_lng?: unknown;
  passenger_location_updated_at?: unknown;
};

/** Punto GPS reciente del pasajero (espera de subida). Null si no hay dato fresco o válido. */
export function passengerLiveMapPoint(booking: PassengerLiveLocationFields | null | undefined): Point | null {
  if (!booking) return null;
  const lat = booking.passenger_lat;
  const lng = booking.passenger_lng;
  if (lat == null || lng == null) return null;
  const la = Number(lat);
  const lo = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (Math.abs(la) < 1e-5 && Math.abs(lo) < 1e-5) return null;

  const updatedRaw = booking.passenger_location_updated_at;
  if (updatedRaw != null && String(updatedRaw).trim() !== '') {
    const updatedMs = new Date(String(updatedRaw)).getTime();
    if (Number.isFinite(updatedMs) && Date.now() - updatedMs > MAX_AGE_MS) return null;
  }

  return { lat: la, lng: lo };
}

export function passengerDisplayFirstName(fullName: string | null | undefined): string {
  const t = String(fullName ?? '').trim();
  if (!t) return 'Pasajero';
  return t.split(/\s+/)[0] ?? 'Pasajero';
}
