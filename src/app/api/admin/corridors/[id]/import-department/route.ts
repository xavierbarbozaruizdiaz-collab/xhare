import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';
import {
  importCorridorDepartmentCities,
  isCorridorImportDepartmentId,
} from '@/lib/admin/corridor-city-import';

export const dynamic = 'force-dynamic';
/** Nominatim + varias ciudades puede superar el default de Vercel. */
export const maxDuration = 60;

const BLOCK = 'admin-corridors-import-department';
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 8;

/**
 * POST /api/admin/corridors/:id/import-department
 * Body: { kind: 'origin' | 'destination', department: 'central' | 'alto_parana' | 'itapua' }
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  return withAdminAuth(request, async (_req, user) => {
    const id = params.id?.trim();
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: 'id inválido' }, { status: 400 });
    }
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
    }
    const kind = (raw as { kind?: unknown })?.kind;
    const department = (raw as { department?: unknown })?.department;
    if (kind !== 'origin' && kind !== 'destination') {
      return NextResponse.json({ error: 'kind debe ser origin o destination' }, { status: 400 });
    }
    if (!isCorridorImportDepartmentId(department)) {
      return NextResponse.json({ error: 'department inválido' }, { status: 400 });
    }

    try {
      const clientId = getClientId(request, user.id);
      if (!checkRateLimit(`admin-corridors-import-department:${department}:${clientId}`, WINDOW_MS, MAX_PER_WINDOW)) {
        return NextResponse.json({ error: 'Demasiadas solicitudes. Esperá un momento.' }, { status: 429 });
      }

      const svc = createServiceClient();
      const result = await importCorridorDepartmentCities(svc, id, kind, department);
      if (!result.ok) {
        if (result.status >= 500) {
          logBlockError(BLOCK, result.error);
        }
        return NextResponse.json(
          { error: result.error, missing: result.missing },
          { status: result.status }
        );
      }

      logBlockOk(BLOCK);
      return NextResponse.json({
        corridor: result.corridor,
        imported: result.imported,
        missing: result.missing,
        department: result.department,
      });
    } catch (e) {
      logBlockError(BLOCK, e instanceof Error ? e.message : 'unknown', e);
      return NextResponse.json({ error: 'Error interno' }, { status: 500 });
    }
  });
}
