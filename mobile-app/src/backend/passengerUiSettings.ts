/**
 * Flags de UI para pasajero leídos desde `settings` en Supabase (RLS: solo claves permitidas).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isEnvConfigured } from './supabase';
import { env } from '../core/env';

const PASSENGER_HOME_FAVORITES_COPY_CACHE_KEY = '@xhare/passenger_home_favorites_copy_v1';

export const PASSENGER_HOME_SHORTCUTS_VISIBLE_KEY = 'passenger_home_shortcuts_visible';
export const PASSENGER_HOME_FAVORITES_TITLE_KEY = 'passenger_home_favorites_title';
export const PASSENGER_HOME_FAVORITES_SUBTITLE_KEY = 'passenger_home_favorites_subtitle';
export const PASSENGER_PRICING_POLYLINE_VISIBLE_KEY = 'passenger_pricing_polyline_visible';

/** Solo si no hay cache ni red; no usar como estado inicial de pantalla (evita pestañeo). */
export const DEFAULT_PASSENGER_HOME_FAVORITES_TITLE = 'Precio de moto, comodidad de auto';
export const DEFAULT_PASSENGER_HOME_FAVORITES_SUBTITLE = 'Activa solo el trayecto que quieras';

export type PassengerHomeFavoritesCopy = { title: string; subtitle: string };

export async function readPassengerHomeFavoritesCopyCache(): Promise<PassengerHomeFavoritesCopy | null> {
  try {
    const raw = await AsyncStorage.getItem(PASSENGER_HOME_FAVORITES_COPY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { title?: unknown; subtitle?: unknown };
    const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
    const subtitle = typeof parsed.subtitle === 'string' ? parsed.subtitle.trim() : '';
    if (!title || !subtitle) return null;
    return { title, subtitle };
  } catch {
    return null;
  }
}

export async function writePassengerHomeFavoritesCopyCache(copy: PassengerHomeFavoritesCopy): Promise<void> {
  try {
    await AsyncStorage.setItem(PASSENGER_HOME_FAVORITES_COPY_CACHE_KEY, JSON.stringify(copy));
  } catch {
    /* ignore */
  }
}

function normalizeFavoritesCopy(title: string, subtitle: string): PassengerHomeFavoritesCopy {
  return {
    title: title.trim() || DEFAULT_PASSENGER_HOME_FAVORITES_TITLE,
    subtitle: subtitle.trim() || DEFAULT_PASSENGER_HOME_FAVORITES_SUBTITLE,
  };
}

function parseShortcutsVisible(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object' && 'visible' in (value as object)) {
    return Boolean((value as { visible?: boolean }).visible);
  }
  return true;
}

function parseBooleanSetting(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object' && 'visible' in (value as object)) {
    return Boolean((value as { visible?: boolean }).visible);
  }
  return fallback;
}

/** Si falla la red o no hay fila, se asume visible (comportamiento anterior). */
export async function fetchPassengerHomeShortcutsVisible(): Promise<boolean> {
  const api = await fetchPassengerUiSettingsFromApi();
  if (api && typeof api.shortcutsVisible === 'boolean') return api.shortcutsVisible;
  if (!isEnvConfigured()) return true;
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', PASSENGER_HOME_SHORTCUTS_VISIBLE_KEY)
    .maybeSingle();
  if (error || data == null) return true;
  return parseShortcutsVisible(data.value);
}

function parseTextValue(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object' && 'text' in (value as object)) {
    const nested = (value as { text?: unknown }).text;
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
  }
  return fallback;
}

type PassengerUiSettingsPayload = {
  shortcutsVisible?: boolean;
  favoritesTitle?: string;
  favoritesSubtitle?: string;
  pricingPolylineVisible?: boolean;
};

async function fetchPassengerUiSettingsFromApi(): Promise<PassengerUiSettingsPayload | null> {
  const base = env.apiBaseUrl?.trim();
  if (!base) return null;
  const url = `${base.replace(/\/$/, '')}/api/settings/passenger-ui?t=${Date.now()}`;
  try {
    const res = await fetch(url, { method: 'GET', cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as PassengerUiSettingsPayload;
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

export async function fetchPassengerHomeFavoritesCopy(): Promise<PassengerHomeFavoritesCopy> {
  const cached = await readPassengerHomeFavoritesCopyCache();

  const api = await fetchPassengerUiSettingsFromApi();
  if (api && (typeof api.favoritesTitle === 'string' || typeof api.favoritesSubtitle === 'string')) {
    const copy = normalizeFavoritesCopy(
      typeof api.favoritesTitle === 'string' && api.favoritesTitle.trim()
        ? api.favoritesTitle.trim()
        : cached?.title ?? DEFAULT_PASSENGER_HOME_FAVORITES_TITLE,
      typeof api.favoritesSubtitle === 'string' && api.favoritesSubtitle.trim()
        ? api.favoritesSubtitle.trim()
        : cached?.subtitle ?? DEFAULT_PASSENGER_HOME_FAVORITES_SUBTITLE
    );
    await writePassengerHomeFavoritesCopyCache(copy);
    return copy;
  }
  if (!isEnvConfigured()) {
    if (cached) return cached;
    return normalizeFavoritesCopy(
      DEFAULT_PASSENGER_HOME_FAVORITES_TITLE,
      DEFAULT_PASSENGER_HOME_FAVORITES_SUBTITLE
    );
  }

  const [titleRes, subtitleRes] = await Promise.all([
    supabase.from('settings').select('value').eq('key', PASSENGER_HOME_FAVORITES_TITLE_KEY).maybeSingle(),
    supabase.from('settings').select('value').eq('key', PASSENGER_HOME_FAVORITES_SUBTITLE_KEY).maybeSingle(),
  ]);

  const copy = normalizeFavoritesCopy(
    titleRes.error
      ? cached?.title ?? DEFAULT_PASSENGER_HOME_FAVORITES_TITLE
      : parseTextValue(titleRes.data?.value, cached?.title ?? DEFAULT_PASSENGER_HOME_FAVORITES_TITLE),
    subtitleRes.error
      ? cached?.subtitle ?? DEFAULT_PASSENGER_HOME_FAVORITES_SUBTITLE
      : parseTextValue(subtitleRes.data?.value, cached?.subtitle ?? DEFAULT_PASSENGER_HOME_FAVORITES_SUBTITLE)
  );
  await writePassengerHomeFavoritesCopyCache(copy);
  return copy;
}

/**
 * Flag admin para auditar la ruta usada en pricing (pasajero-only) sobre el mapa de reserva.
 * Default: oculta para no afectar UX.
 */
export async function fetchPassengerPricingPolylineVisible(): Promise<boolean> {
  const api = await fetchPassengerUiSettingsFromApi();
  if (api && typeof api.pricingPolylineVisible === 'boolean') return api.pricingPolylineVisible;
  if (!isEnvConfigured()) return false;
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', PASSENGER_PRICING_POLYLINE_VISIBLE_KEY)
    .maybeSingle();
  if (error || data == null) return false;
  return parseBooleanSetting(data.value, false);
}
