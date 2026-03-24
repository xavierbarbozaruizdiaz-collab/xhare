/**
 * Geocode: call Next.js API /api/geocode/search (Nominatim) for address suggestions.
 * Used for: passenger "Guardar solicitud" (get lat/lng), driver publish (origin/destination).
 */
import { env } from '../core/env';

export type GeocodeSuggestion = {
  lat: string;
  lon: string;
  display_name: string;
  place_id?: number;
};

function getApiBase(): string {
  const base = env.apiBaseUrl?.trim();
  return base ? base.replace(/\/$/, '') : '';
}

const GEOCODE_FETCH_TIMEOUT_MS = 8_000;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), GEOCODE_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function searchAddresses(query: string, limit = 5): Promise<GeocodeSuggestion[]> {
  const base = getApiBase();
  if (!base || query.trim().length < 2) return [];
  const url = `${base}/api/geocode/search?q=${encodeURIComponent(query.trim())}&limit=${limit}&countrycodes=py`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    const seen = new Set<string>();
    const deduped: GeocodeSuggestion[] = [];
    for (const raw of data as GeocodeSuggestion[]) {
      const key = `${raw.place_id ?? ''}|${String(raw.lat)}|${String(raw.lon)}|${String(raw.display_name ?? '').trim().toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(raw);
      if (deduped.length >= limit) break;
    }
    return deduped;
  } catch {
    return [];
  }
}

/** Reverse geocode: coords → display name (Nominatim via backend). */
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const r = await reverseGeocodeStructured(lat, lng);
  return r.displayName;
}

export type ReverseGeocodeResult = {
  displayName: string;
  city?: string | null;
  department?: string | null;
  barrio?: string | null;
};

/** Reverse geocode: coords → display name + city/barrio for trip_requests and filters. */
export async function reverseGeocodeStructured(lat: number, lng: number): Promise<ReverseGeocodeResult> {
  const base = getApiBase();
  const fallback = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  if (!base) return { displayName: fallback };
  try {
    const res = await fetchWithTimeout(
      `${base}/api/geocode/reverse?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`
    );
    if (!res.ok) return { displayName: fallback };
    const data = await res.json();
    const addr = data.address as Record<string, string> | undefined;
    const city = addr?.city ?? addr?.town ?? addr?.municipality ?? addr?.state ?? null;
    const department = addr?.state ?? addr?.county ?? null;
    const barrio = addr?.suburb ?? addr?.neighbourhood ?? addr?.quarter ?? null;
    return {
      displayName: (data.display_name as string) || fallback,
      city: city ?? null,
      department: department ?? null,
      barrio: barrio ?? null,
    };
  } catch {
    return { displayName: fallback, city: null, department: null, barrio: null };
  }
}
