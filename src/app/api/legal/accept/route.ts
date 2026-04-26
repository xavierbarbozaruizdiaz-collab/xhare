import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuth } from '@/lib/api-auth';
import { createServiceClient } from '@/lib/supabase/server';
import {
  DEFAULT_PRIVACY_VERSION,
  DEFAULT_TERMS_VERSION,
  LEGAL_SETTINGS_KEYS,
} from '@/lib/legal-documents';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';

const bodySchema = z.object({
  source: z.enum(['web', 'mobile']),
});

const LEGAL_ACCEPT_WINDOW_MS = 60_000;
const LEGAL_ACCEPT_MAX_PER_WINDOW = 12;

function getRequestIp(request: NextRequest) {
  const xff = request.headers.get('x-forwarded-for') ?? '';
  const first = xff.split(',').map((s) => s.trim()).filter(Boolean)[0];
  if (first) return first.slice(0, 120);
  const realIp = request.headers.get('x-real-ip') ?? '';
  return realIp.trim().slice(0, 120) || null;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuth(request);
    if (auth instanceof NextResponse) return auth;
    const clientId = getClientId(request, auth.user.id);
    if (!checkRateLimit(`legal-accept:${clientId}`, LEGAL_ACCEPT_WINDOW_MS, LEGAL_ACCEPT_MAX_PER_WINDOW)) {
      return NextResponse.json(
        { error: 'Demasiadas solicitudes. Esperá un momento.' },
        { status: 429 }
      );
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Body inválido: source requerido.' }, { status: 400 });
    }

    const service = createServiceClient();
    const [termsRes, privacyRes] = await Promise.all([
      service.from('settings').select('value').eq('key', LEGAL_SETTINGS_KEYS.termsVersion).maybeSingle(),
      service.from('settings').select('value').eq('key', LEGAL_SETTINGS_KEYS.privacyVersion).maybeSingle(),
    ]);
    const termsVersionRaw = termsRes.data?.value;
    const privacyVersionRaw = privacyRes.data?.value;
    const termsVersion =
      typeof termsVersionRaw === 'string' && termsVersionRaw.trim()
        ? termsVersionRaw.trim()
        : DEFAULT_TERMS_VERSION;
    const privacyVersion =
      typeof privacyVersionRaw === 'string' && privacyVersionRaw.trim()
        ? privacyVersionRaw.trim()
        : DEFAULT_PRIVACY_VERSION;
    const acceptedAt = new Date().toISOString();

    const { error: profileError } = await service
      .from('profiles')
      .update({
        terms_accepted_at: acceptedAt,
        privacy_accepted_at: acceptedAt,
        terms_version: termsVersion,
        privacy_version: privacyVersion,
      })
      .eq('id', auth.user.id);
    if (profileError) {
      console.error('[legal/accept] profile update error:', profileError.message);
      return NextResponse.json({ error: 'No se pudo registrar la aceptación legal.' }, { status: 400 });
    }

    const userAgent = (request.headers.get('user-agent') ?? '').slice(0, 500) || null;
    const ip = getRequestIp(request);
    const { error: auditError } = await service.from('legal_acceptance_events').insert({
      user_id: auth.user.id,
      source: parsed.data.source,
      terms_version: termsVersion,
      privacy_version: privacyVersion,
      accepted_at: acceptedAt,
      ip,
      user_agent: userAgent,
    });
    if (auditError) {
      console.error('[legal/accept] audit insert error:', auditError.message);
      return NextResponse.json({ error: 'No se pudo registrar la auditoría legal.' }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      accepted_at: acceptedAt,
      terms_version: termsVersion,
      privacy_version: privacyVersion,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
