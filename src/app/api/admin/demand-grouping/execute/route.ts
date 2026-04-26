import { NextRequest, NextResponse } from 'next/server';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const BLOCK = 'admin-demand-grouping-execute';
const ADMIN_DEMAND_GROUPING_EXECUTE_WINDOW_MS = 60_000;
const ADMIN_DEMAND_GROUPING_EXECUTE_MAX_PER_WINDOW = 20;

/**
 * POST /api/admin/demand-grouping/execute
 * Deshabilitado: la ejecución se realiza exclusivamente por cron.
 */
export async function POST(request: NextRequest) {
  return withAdminAuth(request, async (_req, user) => {
    try {
      const clientId = getClientId(request, user.id);
      if (!checkRateLimit(`admin-demand-grouping-execute:${clientId}`, ADMIN_DEMAND_GROUPING_EXECUTE_WINDOW_MS, ADMIN_DEMAND_GROUPING_EXECUTE_MAX_PER_WINDOW)) {
        return NextResponse.json({ error: 'Demasiadas solicitudes. Esperá un momento.' }, { status: 429 });
      }
      logBlockOk(BLOCK);
      return NextResponse.json({
        ok: false,
        disabled: true,
        engineMode: 'cron_only',
        message: 'Ejecucion desde panel admin deshabilitada. Usa GET/POST /api/cron/demand-grouping con secret.',
      }, { status: 403 });
    } catch (e) {
      logBlockError(BLOCK, e instanceof Error ? e.message : 'unknown', e);
      return NextResponse.json(
        { error: 'Error interno' },
        { status: 500 }
      );
    }
  });
}
