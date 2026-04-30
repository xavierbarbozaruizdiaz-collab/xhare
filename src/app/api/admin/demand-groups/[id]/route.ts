import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';
import { buildDemandRouteGroupDetailResult } from '@/lib/demand-route-group-detail-build';

export const dynamic = 'force-dynamic';

const BLOCK = 'admin-demand-groups-id';
const ADMIN_DEMAND_GROUP_DETAIL_WINDOW_MS = 60_000;
const ADMIN_DEMAND_GROUP_DETAIL_MAX_PER_WINDOW = 50;
const ADMIN_DEMAND_GROUP_DELETE_WINDOW_MS = 60_000;
const ADMIN_DEMAND_GROUP_DELETE_MAX_PER_WINDOW = 20;

/**
 * GET /api/admin/demand-groups/[id]
 * Mismo payload que GET /api/demand-routes/[id] pero con `withAdminAuth` (evita 401 en panel cuando el JWT
 * no llega bien a `createServerClient` + `auth.getUser` en algunos despliegues).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAdminAuth(request, async (_req, user) => {
    try {
      const clientId = getClientId(request, user.id);
      if (!checkRateLimit(`admin-demand-group-get:${clientId}`, ADMIN_DEMAND_GROUP_DETAIL_WINDOW_MS, ADMIN_DEMAND_GROUP_DETAIL_MAX_PER_WINDOW)) {
        return NextResponse.json(
          { error: 'Demasiadas solicitudes. Esperá un momento.' },
          { status: 429 }
        );
      }
      const { id } = await params;
      if (!id || !String(id).trim()) {
        return NextResponse.json({ error: 'id requerido' }, { status: 400 });
      }
      const service = createServiceClient();
      const result = await buildDemandRouteGroupDetailResult(service, id);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      logBlockOk(`${BLOCK}-get`);
      return NextResponse.json(result.body);
    } catch (e) {
      logBlockError(`${BLOCK}-get`, e instanceof Error ? e.message : 'unknown', e);
      return NextResponse.json({ error: 'Error interno' }, { status: 500 });
    }
  });
}

/**
 * DELETE /api/admin/demand-groups/[id]
 * Disuelve el agrupamiento de forma atómica vía RPC en DB.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAdminAuth(request, async (_req, user) => {
    try {
      const clientId = getClientId(request, user.id);
      if (!checkRateLimit(`admin-demand-group-delete:${clientId}`, ADMIN_DEMAND_GROUP_DELETE_WINDOW_MS, ADMIN_DEMAND_GROUP_DELETE_MAX_PER_WINDOW)) {
        return NextResponse.json(
          { error: 'Demasiadas solicitudes. Esperá un momento.' },
          { status: 429 }
        );
      }
      const { id: groupId } = await params;
      if (!groupId || !String(groupId).trim()) {
        return NextResponse.json({ error: 'id requerido' }, { status: 400 });
      }

      const service = createServiceClient();
      const { data, error } = await service.rpc('dissolve_demand_group', {
        p_group_id: groupId,
      });
      if (error) {
        const normalized = [error.code, error.message, error.details, error.hint]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        logBlockError(BLOCK, `dissolve_demand_group: ${error.message}`, error);
        if (normalized.includes('group_not_found')) {
          return NextResponse.json({ error: 'Grupo no encontrado' }, { status: 404 });
        }
        if (normalized.includes('group_has_active_ride')) {
          return NextResponse.json(
            {
              error:
                'Este grupo tiene un viaje publicado o en curso. Cancelá o completá ese viaje desde la app o el panel de Viajes antes de disolver el agrupamiento.',
            },
            { status: 409 }
          );
        }
        return NextResponse.json(
          { error: 'No se pudo disolver el grupo de demanda.' },
          { status: 400 }
        );
      }

      logBlockOk(BLOCK);
      return NextResponse.json(data ?? { ok: true, dissolved_group_id: groupId });
    } catch (e) {
      logBlockError(BLOCK, e instanceof Error ? e.message : 'unknown', e);
      return NextResponse.json({ error: 'Error interno' }, { status: 500 });
    }
  });
}
