import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/admin-auth';
import { getOsrmBaseUrl, getOsrmRequestTimeoutMs } from '@/lib/osrm-routing';

type Point = { lat: number; lng: number };

const MAX_POINTS = 25;

/**
 * POST /api/admin/dispatch-osrm-route
 * Body: { points: { lat, lng }[] } en orden (mínimo 2).
 * Devuelve polyline siguiendo calles vía motor OSRM-compatible (overview=full, geojson).
 */
export async function POST(request: NextRequest) {
  return withAdminAuth(request, async () => {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
    }
    const body = raw as { points?: unknown };
    if (!Array.isArray(body.points) || body.points.length < 2) {
      return NextResponse.json({ error: 'Se requieren al menos 2 puntos { lat, lng }' }, { status: 400 });
    }

    const coords: Point[] = [];
    for (const p of body.points.slice(0, MAX_POINTS)) {
      if (!p || typeof p !== 'object') continue;
      const lat = Number((p as Point).lat);
      const lng = Number((p as Point).lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) coords.push({ lat, lng });
    }
    if (coords.length < 2) {
      return NextResponse.json({ error: 'Coordenadas inválidas' }, { status: 400 });
    }

    const straightFallback = (): NextResponse => {
      return NextResponse.json({
        polyline: coords,
        source: 'straight' as const,
        warning: 'No se pudo calcular ruta por calles; se muestra línea recta entre paradas.',
      });
    };

    const path = coords.map((p) => `${p.lng},${p.lat}`).join(';');
    const base = getOsrmBaseUrl();
    const timeoutMs = getOsrmRequestTimeoutMs();
    const url = `${base}/route/v1/driving/${path}?overview=full&geometries=geojson`;

    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        cache: 'no-store',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      }).finally(() => clearTimeout(t));

      if (!res.ok) {
        return NextResponse.json({
          polyline: coords,
          source: 'straight' as const,
          warning: `OSRM respondió ${res.status}. Configurá OSRM_BASE_URL en producción si el demo falla.`,
        });
      }

      const data = (await res.json()) as {
        code?: string;
        message?: string;
        routes?: Array<{ geometry?: { coordinates?: number[][] } }>;
      };

      if (data.code !== 'Ok' || !data.routes?.[0]?.geometry?.coordinates) {
        return NextResponse.json({
          polyline: coords,
          source: 'straight' as const,
          warning: data.message ?? 'OSRM no devolvió geometría para esta secuencia de puntos.',
        });
      }

      const ring = data.routes[0].geometry!.coordinates!;
      const polyline = ring.map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

      if (polyline.length < 2) {
        return straightFallback();
      }

      return NextResponse.json({ polyline, source: 'osrm' as const });
    } catch {
      return NextResponse.json({
        polyline: coords,
        source: 'straight' as const,
        warning:
          'OSRM no respondió a tiempo o hubo error de red. En producción usá OSRM_BASE_URL propio (ver comentarios en src/lib/osrm-routing.ts).',
      });
    }
  });
}
