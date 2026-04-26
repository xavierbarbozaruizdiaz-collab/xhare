import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const BLOCK = 'admin-corridors-rollback';
const ADMIN_CORRIDOR_ROLLBACK_WINDOW_MS = 60_000;
const ADMIN_CORRIDOR_ROLLBACK_MAX_PER_WINDOW = 10;

type CorrSnap = {
  id: string;
  name: string;
  slug: string;
  origin_zone: Record<string, unknown>;
  destination_zone: Record<string, unknown>;
  sort_priority: number;
  is_active: boolean;
};

/** POST /api/admin/corridors/versions/:id/rollback */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  return withAdminAuth(request, async (_req, user) => {
    const id = params.id?.trim();
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: 'id inválido' }, { status: 400 });
    }
    try {
      const clientId = getClientId(request, user.id);
      if (!checkRateLimit(`admin-corridors-rollback:${clientId}`, ADMIN_CORRIDOR_ROLLBACK_WINDOW_MS, ADMIN_CORRIDOR_ROLLBACK_MAX_PER_WINDOW)) {
        return NextResponse.json({ error: 'Demasiadas solicitudes. Esperá un momento.' }, { status: 429 });
      }
      const svc = createServiceClient();
      const { data: row, error } = await svc
        .from('admin_corridor_config_versions')
        .select('id, corridors_snapshot')
        .eq('id', id)
        .maybeSingle();
      if (error) {
        logBlockError(BLOCK, error.message, error);
        return NextResponse.json({ error: 'No se pudo leer la versión solicitada.' }, { status: 400 });
      }
      if (!row) return NextResponse.json({ error: 'Versión no encontrada' }, { status: 404 });
      const snap = (row.corridors_snapshot ?? []) as CorrSnap[];
      for (const c of snap) {
        const { error: upErr } = await svc
          .from('corridors')
          .update({
            name: c.name,
            slug: c.slug,
            origin_zone: c.origin_zone,
            destination_zone: c.destination_zone,
            sort_priority: c.sort_priority,
            is_active: c.is_active,
          })
          .eq('id', c.id);
        if (upErr) {
          logBlockError(BLOCK, upErr.message, upErr);
          return NextResponse.json({ error: 'No se pudo restaurar uno de los corredores.' }, { status: 400 });
        }
      }
      const { error: unpubErr } = await svc
        .from('admin_corridor_config_versions')
        .update({ is_published: false })
        .eq('is_published', true);
      if (unpubErr) {
        logBlockError(BLOCK, unpubErr.message, unpubErr);
        return NextResponse.json({ error: 'No se pudo despublicar la versión actual.' }, { status: 400 });
      }
      const { error: pubErr } = await svc
        .from('admin_corridor_config_versions')
        .update({ is_published: true })
        .eq('id', id);
      if (pubErr) {
        logBlockError(BLOCK, pubErr.message, pubErr);
        return NextResponse.json({ error: 'No se pudo publicar la versión restaurada.' }, { status: 400 });
      }

      logBlockOk(BLOCK);
      return NextResponse.json({ ok: true, restored: snap.length });
    } catch (e) {
      logBlockError(BLOCK, e instanceof Error ? e.message : 'unknown', e);
      return NextResponse.json({ error: 'Error interno' }, { status: 500 });
    }
  });
}

