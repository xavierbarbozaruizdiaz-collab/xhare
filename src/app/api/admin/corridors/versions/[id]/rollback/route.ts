import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

const BLOCK = 'admin-corridors-rollback';

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
  return withAdminAuth(request, async () => {
    const id = params.id?.trim();
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: 'id inválido' }, { status: 400 });
    }
    try {
      const svc = createServiceClient();
      const { data: row, error } = await svc
        .from('admin_corridor_config_versions')
        .select('id, corridors_snapshot')
        .eq('id', id)
        .maybeSingle();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
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
        if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });
      }
      const { error: unpubErr } = await svc
        .from('admin_corridor_config_versions')
        .update({ is_published: false })
        .eq('is_published', true);
      if (unpubErr) return NextResponse.json({ error: unpubErr.message }, { status: 400 });
      const { error: pubErr } = await svc
        .from('admin_corridor_config_versions')
        .update({ is_published: true })
        .eq('id', id);
      if (pubErr) return NextResponse.json({ error: pubErr.message }, { status: 400 });

      logBlockOk(BLOCK);
      return NextResponse.json({ ok: true, restored: snap.length });
    } catch (e) {
      logBlockError(BLOCK, e instanceof Error ? e.message : 'unknown', e);
      return NextResponse.json({ error: 'Error interno' }, { status: 500 });
    }
  });
}

