import { NextResponse } from 'next/server';
import { authGetUser, createServerClient, createServiceClient } from '@/lib/supabase/server';
import { runDemandRoutesGeoSync } from '@/lib/demand-routes-geo-sync';

/**
 * POST /api/demand-routes/sync
 * Recomputa grupos: pending trip_requests sin grupo → obtiene polyline si falta, agrupa por fecha/hora/ciudad/corredor 2km, crea demand_route_groups y demand_route_members.
 * Requiere usuario autenticado con rol driver o admin (o cron con DEMAND_ROUTES_SYNC_SECRET).
 */
export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization');
    const cronSecret = process.env.DEMAND_ROUTES_SYNC_SECRET;
    const useCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

    if (!useCron) {
      const server = createServerClient(request);
      const {
        data: { user },
        error: authError,
      } = await authGetUser(server, request);
      if (authError || !user) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
      }
      const { data: profile } = await server.from('profiles').select('role').eq('id', user.id).single();
      if (!profile || !['driver', 'admin'].includes(profile.role)) {
        return NextResponse.json({ error: 'Solo conductor o admin pueden ejecutar sync' }, { status: 403 });
      }
    }

    const supabase = createServiceClient();
    const result = await runDemandRoutesGeoSync(supabase);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    if (result.message) {
      return NextResponse.json({
        ok: true,
        message: result.message,
        processed: result.processed,
        addedToExisting: result.addedToExisting,
        newGroupsCreated: result.newGroupsCreated,
      });
    }
    return NextResponse.json({
      ok: true,
      processed: result.processed,
      addedToExisting: result.addedToExisting,
      newGroupsCreated: result.newGroupsCreated,
    });
  } catch (e) {
    console.error('demand-routes sync error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error interno' },
      { status: 500 }
    );
  }
}
