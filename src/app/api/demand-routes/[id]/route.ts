import { NextRequest, NextResponse } from 'next/server';
import { authGetUser, createServerClient, createServiceClient } from '@/lib/supabase/server';

/**
 * GET /api/demand-routes/[id]
 * Detalle de una ruta agrupada: polyline base + puntos de cada pasajero (origen/destino) para el mapa.
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

    const { data: group, error: groupError } = await supabase
      .from('demand_route_groups')
      .select('id, base_trip_request_id, base_polyline, base_length_km, requested_date, requested_time, origin_city, destination_city, passenger_count')
      .eq('id', id)
      .single();

    if (groupError || !group) {
      return NextResponse.json({ error: 'Grupo no encontrado' }, { status: 404 });
    }

    const { data: members, error: membersError } = await supabase
      .from('demand_route_members')
      .select('trip_request_id')
      .eq('group_id', id);

    if (membersError) {
      console.error('demand-routes detail members error:', membersError);
      return NextResponse.json({ error: membersError.message }, { status: 500 });
    }

    const requestIds = (members ?? []).map((m) => m.trip_request_id).filter(Boolean);
    let passengers: Array<{
      trip_request_id: string;
      origin_lat: number;
      origin_lng: number;
      origin_label: string | null;
      destination_lat: number;
      destination_lng: number;
      destination_label: string | null;
    }> = [];

    if (requestIds.length > 0) {
      const service = createServiceClient();
      const { data: requests, error: reqError } = await service
        .from('trip_requests')
        .select('id, origin_lat, origin_lng, origin_label, destination_lat, destination_lng, destination_label')
        .in('id', requestIds);

      if (!reqError && requests) {
        passengers = requests.map((r) => ({
          trip_request_id: r.id,
          origin_lat: r.origin_lat,
          origin_lng: r.origin_lng,
          origin_label: r.origin_label ?? null,
          destination_lat: r.destination_lat,
          destination_lng: r.destination_lng,
          destination_label: r.destination_label ?? null,
        }));
      }
    }

    return NextResponse.json({
      id: group.id,
      base_trip_request_id: group.base_trip_request_id ?? null,
      base_polyline: group.base_polyline,
      base_length_km: group.base_length_km,
      requested_date: group.requested_date,
      requested_time: group.requested_time,
      origin_city: group.origin_city,
      destination_city: group.destination_city,
      passenger_count: group.passenger_count,
      passengers,
    });
  } catch (e) {
    console.error('demand-routes [id] GET error:', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
