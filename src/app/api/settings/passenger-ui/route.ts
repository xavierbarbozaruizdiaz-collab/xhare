import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

const DEFAULT = {
  shortcutsVisible: true,
  favoritesTitle: 'Hola. Configura tus favoritos para viajes rapidos.',
  favoritesSubtitle:
    'Lista apilada con switch: activas solo el trayecto que quieras usar. Cada fila muestra la hora de recogida.',
  pricingPolylineVisible: false,
};

function asBoolean(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === 'boolean') return raw;
  if (raw && typeof raw === 'object' && 'visible' in (raw as object)) {
    return Boolean((raw as { visible?: unknown }).visible);
  }
  return fallback;
}

function asText(raw: unknown, fallback: string): string {
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (raw && typeof raw === 'object' && 'text' in (raw as object)) {
    const nested = (raw as { text?: unknown }).text;
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
  }
  return fallback;
}

export async function GET() {
  try {
    const service = createServiceClient();
    const [shortcutsRes, titleRes, subtitleRes, pricingPolylineRes] = await Promise.all([
      service.from('settings').select('value').eq('key', 'passenger_home_shortcuts_visible').maybeSingle(),
      service.from('settings').select('value').eq('key', 'passenger_home_favorites_title').maybeSingle(),
      service.from('settings').select('value').eq('key', 'passenger_home_favorites_subtitle').maybeSingle(),
      service.from('settings').select('value').eq('key', 'passenger_pricing_polyline_visible').maybeSingle(),
    ]);

    return NextResponse.json({
      shortcutsVisible: asBoolean(shortcutsRes.data?.value, DEFAULT.shortcutsVisible),
      favoritesTitle: asText(titleRes.data?.value, DEFAULT.favoritesTitle),
      favoritesSubtitle: asText(subtitleRes.data?.value, DEFAULT.favoritesSubtitle),
      pricingPolylineVisible: asBoolean(pricingPolylineRes.data?.value, DEFAULT.pricingPolylineVisible),
    });
  } catch {
    return NextResponse.json(DEFAULT);
  }
}
