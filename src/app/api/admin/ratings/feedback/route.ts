import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const BLOCK = 'admin-ratings-feedback';
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;

export async function GET(request: NextRequest) {
  return withAdminAuth(request, async (_req, user) => {
    try {
      const clientId = getClientId(request, user.id);
      if (!checkRateLimit(`admin-ratings-feedback:${clientId}`, WINDOW_MS, MAX_PER_WINDOW)) {
        return NextResponse.json(
          { error: 'Demasiadas solicitudes. Esperá un momento.' },
          { status: 429 }
        );
      }

      const { searchParams } = new URL(request.url);
      const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') ?? '30') || 30));
      const offset = Math.max(0, Number(searchParams.get('offset') ?? '0') || 0);
      const onlyWithComment = searchParams.get('with_comment') === '1';

      const service = createServiceClient();
      let query = service
        .from('driver_ratings')
        .select(
          'id, ride_id, stars, comment, created_at, driver_id, passenger_id',
          { count: 'exact' }
        )
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (onlyWithComment) {
        query = query.not('comment', 'is', null).neq('comment', '');
      }

      const { data: rows, error, count } = await query;
      if (error) {
        logBlockError(BLOCK, error.message, error);
        return NextResponse.json(
          { error: 'No se pudieron obtener las calificaciones.' },
          { status: 400 }
        );
      }

      const profileIds = new Set<string>();
      for (const row of rows ?? []) {
        if (row.driver_id) profileIds.add(String(row.driver_id));
        if (row.passenger_id) profileIds.add(String(row.passenger_id));
      }

      let profilesById: Record<string, { full_name: string | null }> = {};
      if (profileIds.size > 0) {
        const { data: profiles } = await service
          .from('profiles')
          .select('id, full_name')
          .in('id', Array.from(profileIds));
        profilesById = Object.fromEntries(
          (profiles ?? []).map((p) => [String(p.id), { full_name: p.full_name ?? null }])
        );
      }

      const ratings = (rows ?? []).map((row) => ({
        id: row.id,
        ride_id: row.ride_id,
        stars: row.stars,
        comment: row.comment ?? null,
        created_at: row.created_at,
        driver: profilesById[String(row.driver_id)] ?? { full_name: null },
        passenger: profilesById[String(row.passenger_id)] ?? { full_name: null },
      }));

      logBlockOk(BLOCK);
      return NextResponse.json({ limit, offset, count: count ?? 0, ratings });
    } catch (err) {
      logBlockError(BLOCK, err instanceof Error ? err.message : 'Unknown error', err);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  });
}
