import { NextRequest, NextResponse } from 'next/server';
import { authGetUser, createServerClient, createServiceClient } from '@/lib/supabase/server';
import { buildDemandRouteGroupDetailResult } from '@/lib/demand-route-group-detail-build';

/**
 * GET /api/demand-routes/[id]
 * Detalle de una ruta agrupada: polyline base + puntos de pasajeros + legs ordenados (Sube/Baja).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = createServerClient(request);
    const {
      data: { user },
      error: authError,
    } = await authGetUser(supabase, request);

    if (authError || !user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'id requerido' }, { status: 400 });
    }

    const service = createServiceClient();
    const result = await buildDemandRouteGroupDetailResult(service, id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.body);
  } catch (e) {
    console.error('demand-routes [id] GET error:', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
