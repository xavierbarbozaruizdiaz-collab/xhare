import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/admin-auth';
import { computeGoogleDrivingRoute } from '@/lib/google-routes-polyline';

type Point = { lat: number; lng: number };

const MAX_POINTS = 25;

/**
 * POST /api/admin/dispatch-osrm-route
 * Ruta histórica del nombre (antes OSRM público). **Mismo motor que `/api/route/polyline`:** Google Routes
 * (`computeGoogleDrivingRoute`, `GOOGLE_MAPS_API_KEY`).
 *
 * Body: { points: { lat, lng }[] } en orden (mínimo 2, máximo 25). Primer punto = origen, último = destino,
 * intermedios = waypoints.
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

    const straightResponse = (warning: string): NextResponse =>
      NextResponse.json({
        polyline: coords,
        source: 'straight' as const,
        warning,
      });

    const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
    if (!apiKey) {
      return straightResponse(
        'Falta GOOGLE_MAPS_API_KEY en el servidor (misma variable que /api/route/polyline). Se muestra línea recta entre paradas.'
      );
    }

    const origin = coords[0]!;
    const destination = coords[coords.length - 1]!;
    const waypoints = coords.length > 2 ? coords.slice(1, -1) : [];

    const google = await computeGoogleDrivingRoute(apiKey, origin, destination, waypoints);
    if (!google || google.polyline.length < 2) {
      return straightResponse(
        'Google Routes no devolvió una ruta por calles para esta secuencia. Revisá cuotas o la clave; se muestra línea recta.'
      );
    }

    return NextResponse.json({ polyline: google.polyline, source: 'google' as const });
  });
}
