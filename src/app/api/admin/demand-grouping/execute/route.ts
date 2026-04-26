import { NextRequest, NextResponse } from 'next/server';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

const BLOCK = 'admin-demand-grouping-execute';

/**
 * POST /api/admin/demand-grouping/execute
 * Deshabilitado: la ejecución se realiza exclusivamente por cron.
 */
export async function POST(request: NextRequest) {
  return withAdminAuth(request, async (_req, _user) => {
    try {
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
        { error: e instanceof Error ? e.message : 'Error interno' },
        { status: 500 }
      );
    }
  });
}
