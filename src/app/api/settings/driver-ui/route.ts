import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DEFAULT_HOW_TO = {
  title: '¿CÓMO EMPEZAR?',
  lines: [
    '1. Publicá una ruta con horario y cupos.',
    '2. Los pasajeros reservan desde la app.',
    '3. Confirmá el viaje, cobrá y sumá calificación.',
  ],
};

function normalizeHowTo(raw: unknown): { title: string; lines: string[] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return DEFAULT_HOW_TO;
  }
  const o = raw as Record<string, unknown>;
  const title =
    typeof o.title === 'string' && o.title.trim() ? o.title.trim() : DEFAULT_HOW_TO.title;
  if (Array.isArray(o.lines)) {
    const lines = o.lines
      .map((x) => (typeof x === 'string' ? x.trim() : String(x ?? '').trim()))
      .filter(Boolean);
    if (lines.length > 0) {
      return { title, lines };
    }
  }
  return { title, lines: DEFAULT_HOW_TO.lines };
}

export async function GET() {
  try {
    const service = createServiceClient();
    const { data } = await service.from('settings').select('value').eq('key', 'driver_home_how_to').maybeSingle();
    const howToStart = normalizeHowTo(data?.value);
    return NextResponse.json(
      { howToStart },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          Pragma: 'no-cache',
          Expires: '0',
        },
      }
    );
  } catch {
    return NextResponse.json(
      { howToStart: DEFAULT_HOW_TO },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          Pragma: 'no-cache',
          Expires: '0',
        },
      }
    );
  }
}
