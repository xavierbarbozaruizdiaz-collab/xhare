import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { logBlockError, logBlockOk, withAdminAuth } from '@/lib/admin-auth';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const BLOCK = 'admin-legal-acceptance-events';
const LEGAL_AUDIT_WINDOW_MS = 60_000;
const LEGAL_AUDIT_MAX_PER_WINDOW = 40;

export async function GET(request: NextRequest) {
  return withAdminAuth(request, async (_req, user) => {
    try {
      const clientId = getClientId(request, user.id);
      if (!checkRateLimit(`admin-legal-audit:${clientId}`, LEGAL_AUDIT_WINDOW_MS, LEGAL_AUDIT_MAX_PER_WINDOW)) {
        return NextResponse.json(
          { error: 'Demasiadas solicitudes. Esperá un momento.' },
          { status: 429 }
        );
      }

      const { searchParams } = new URL(request.url);
      const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit') ?? '50') || 50));
      const offset = Math.max(0, Number(searchParams.get('offset') ?? '0') || 0);
      const source = (searchParams.get('source') ?? '').trim();
      const userId = (searchParams.get('user_id') ?? '').trim();

      const service = createServiceClient();
      let query = service
        .from('legal_acceptance_events')
        .select(
          'id, user_id, source, terms_version, privacy_version, accepted_at, ip, user_agent, created_at',
          { count: 'exact' }
        )
        .order('accepted_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (source === 'web' || source === 'mobile') {
        query = query.eq('source', source);
      }
      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { data: rows, error, count } = await query;
      if (error) {
        logBlockError(BLOCK, error.message, error);
        return NextResponse.json(
          { error: 'No se pudieron obtener los eventos de aceptación legal.' },
          { status: 400 }
        );
      }

      const userIds = Array.from(new Set((rows ?? []).map((r) => String(r.user_id ?? '')).filter(Boolean)));
      let profilesById: Record<string, { full_name: string | null; email: string | null }> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await service
          .from('profiles')
          .select('id, full_name')
          .in('id', userIds);

        const { data: usersAuth } = await service.auth.admin.listUsers({
          page: 1,
          perPage: Math.min(1000, userIds.length),
        });
        const emailById: Record<string, string | null> = {};
        for (const u of usersAuth?.users ?? []) {
          if (userIds.includes(String(u.id))) {
            emailById[String(u.id)] = u.email ?? null;
          }
        }
        for (const p of profiles ?? []) {
          profilesById[String(p.id)] = {
            full_name: p.full_name ?? null,
            email: emailById[String(p.id)] ?? null,
          };
        }
      }

      logBlockOk(BLOCK);
      return NextResponse.json({
        limit,
        offset,
        count: count ?? 0,
        events: (rows ?? []).map((row) => ({
          ...row,
          profile: profilesById[String(row.user_id)] ?? { full_name: null, email: null },
        })),
      });
    } catch (e) {
      logBlockError(BLOCK, e instanceof Error ? e.message : 'unknown', e);
      return NextResponse.json({ error: 'Error interno' }, { status: 500 });
    }
  });
}
