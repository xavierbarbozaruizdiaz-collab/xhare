/**
 * Card «¿Cómo empezar?» en Inicio conductor: lee `settings.driver_home_how_to` (API Next o Supabase).
 */
import { supabase, isEnvConfigured } from './supabase';
import { env } from '../core/env';

export const DRIVER_HOME_HOW_TO_KEY = 'driver_home_how_to';

export const DEFAULT_DRIVER_HOME_HOW_TO: { title: string; lines: string[] } = {
  title: '¿CÓMO EMPEZAR?',
  lines: [
    '1. Publicá una ruta con horario y cupos.',
    '2. Los pasajeros reservan desde la app.',
    '3. Confirmá el viaje, cobrá y sumá calificación.',
  ],
};

export function normalizeDriverHomeHowTo(raw: unknown): { title: string; lines: string[] } {
  const d = DEFAULT_DRIVER_HOME_HOW_TO;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return d;
  }
  const o = raw as Record<string, unknown>;
  const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim() : d.title;
  if (Array.isArray(o.lines)) {
    const lines = o.lines
      .map((x) => (typeof x === 'string' ? x.trim() : String(x ?? '').trim()))
      .filter(Boolean);
    if (lines.length > 0) {
      return { title, lines };
    }
  }
  return { title, lines: d.lines };
}

type DriverUiApiPayload = {
  howToStart?: { title?: string; lines?: unknown };
};

async function fetchDriverUiFromApi(): Promise<{ title: string; lines: string[] } | null> {
  const base = env.apiBaseUrl?.trim();
  if (!base) return null;
  const url = `${base.replace(/\/$/, '')}/api/settings/driver-ui?t=${Date.now()}`;
  try {
    const res = await fetch(url, { method: 'GET', cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as DriverUiApiPayload;
    if (data?.howToStart && typeof data.howToStart === 'object') {
      return normalizeDriverHomeHowTo(data.howToStart);
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchDriverHomeHowTo(): Promise<{ title: string; lines: string[] }> {
  const api = await fetchDriverUiFromApi();
  if (api) return api;
  if (!isEnvConfigured()) {
    return DEFAULT_DRIVER_HOME_HOW_TO;
  }
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', DRIVER_HOME_HOW_TO_KEY)
    .maybeSingle();
  if (error || data == null) {
    return DEFAULT_DRIVER_HOME_HOW_TO;
  }
  return normalizeDriverHomeHowTo(data.value);
}
