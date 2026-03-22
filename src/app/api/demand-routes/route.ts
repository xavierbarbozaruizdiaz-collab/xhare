import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

/**
 * GET /api/demand-routes
 * Lista rutas con demanda agrupadas (para conductor y pasajero).
 * Query: origin_city?, destination_city?, requested_date_from?, requested_date_to?
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient(request);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const originCity = searchParams.get('origin_city')?.trim() || undefined;
    const destinationCity = searchParams.get('destination_city')?.trim() || undefined;
    const dateFrom = searchParams.get('requested_date_from')?.trim() || undefined;
    const dateTo = searchParams.get('requested_date_to')?.trim() || undefined;

    let q = supabase
      .from('demand_route_groups')
      .select('id, base_trip_request_id, base_polyline, base_length_km, requested_date, requested_time, origin_city, origin_barrio, destination_city, destination_barrio, passenger_count, created_at')
      .order('requested_date', { ascending: true })
      .order('requested_time', { ascending: true });

    if (originCity) q = q.ilike('origin_city', `%${originCity}%`);
    if (destinationCity) q = q.ilike('destination_city', `%${destinationCity}%`);
    if (dateFrom) q = q.gte('requested_date', dateFrom);
    if (dateTo) q = q.lte('requested_date', dateTo);

    const { data: groups, error } = await q;

    if (error) {
      console.error('demand-routes list error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ groups: groups ?? [] });
  } catch (e) {
    console.error('demand-routes GET error:', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
