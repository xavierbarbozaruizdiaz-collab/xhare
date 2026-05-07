/**
 * Flags de UI para pasajero leídos desde `settings` en Supabase (RLS: solo claves permitidas).
 */
import { supabase, isEnvConfigured } from './supabase';

export const PASSENGER_HOME_SHORTCUTS_VISIBLE_KEY = 'passenger_home_shortcuts_visible';
export const PASSENGER_HOME_FAVORITES_TITLE_KEY = 'passenger_home_favorites_title';
export const PASSENGER_HOME_FAVORITES_SUBTITLE_KEY = 'passenger_home_favorites_subtitle';
export const PASSENGER_PRICING_POLYLINE_VISIBLE_KEY = 'passenger_pricing_polyline_visible';

export const DEFAULT_PASSENGER_HOME_FAVORITES_TITLE = 'Hola. Configura tus favoritos para viajes rapidos.';
export const DEFAULT_PASSENGER_HOME_FAVORITES_SUBTITLE =
  'Lista apilada con switch: activas solo el trayecto que quieras usar. Cada fila muestra la hora de recogida.';

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

export async function fetchPassengerHomeFavoritesCopy(): Promise<{ title: string; subtitle: string }> {
  if (!isEnvConfigured()) {
    return {
      title: DEFAULT_PASSENGER_HOME_FAVORITES_TITLE,
      subtitle: DEFAULT_PASSENGER_HOME_FAVORITES_SUBTITLE,
    };
  }

  const [titleRes, subtitleRes] = await Promise.all([
    supabase.from('settings').select('value').eq('key', PASSENGER_HOME_FAVORITES_TITLE_KEY).maybeSingle(),
    supabase.from('settings').select('value').eq('key', PASSENGER_HOME_FAVORITES_SUBTITLE_KEY).maybeSingle(),
  ]);

  return {
    title: titleRes.error
      ? DEFAULT_PASSENGER_HOME_FAVORITES_TITLE
      : parseTextValue(titleRes.data?.value, DEFAULT_PASSENGER_HOME_FAVORITES_TITLE),
    subtitle: subtitleRes.error
      ? DEFAULT_PASSENGER_HOME_FAVORITES_SUBTITLE
      : parseTextValue(subtitleRes.data?.value, DEFAULT_PASSENGER_HOME_FAVORITES_SUBTITLE),
  };
}

/**
 * Flag admin para auditar la ruta usada en pricing (pasajero-only) sobre el mapa de reserva.
 * Default: oculta para no afectar UX.
 */
export async function fetchPassengerPricingPolylineVisible(): Promise<boolean> {
  if (!isEnvConfigured()) return false;
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', PASSENGER_PRICING_POLYLINE_VISIBLE_KEY)
    .maybeSingle();
  if (error || data == null) return false;
  return parseBooleanSetting(data.value, false);
}
