import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import {
  DEFAULT_PRIVACY_CONTENT,
  DEFAULT_PRIVACY_VERSION,
  DEFAULT_TERMS_CONTENT,
  DEFAULT_TERMS_VERSION,
  interpolateLegalTemplate,
  LEGAL_SETTINGS_KEYS,
  type LegalDocumentType,
} from '@/lib/legal-documents';

function normalizeType(raw: string | null): LegalDocumentType | null {
  if (raw === 'terms' || raw === 'privacy') return raw;
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const type = normalizeType(new URL(request.url).searchParams.get('type'));
    if (!type) {
      return NextResponse.json(
        { error: 'type invalido. Usa terms o privacy.' },
        { status: 400 }
      );
    }

    const service = createServiceClient();
    const contentKey =
      type === 'terms'
        ? LEGAL_SETTINGS_KEYS.termsContent
        : LEGAL_SETTINGS_KEYS.privacyContent;
    const versionKey =
      type === 'terms'
        ? LEGAL_SETTINGS_KEYS.termsVersion
        : LEGAL_SETTINGS_KEYS.privacyVersion;

    const [contentRes, versionRes] = await Promise.all([
      service.from('settings').select('value, updated_at').eq('key', contentKey).maybeSingle(),
      service.from('settings').select('value').eq('key', versionKey).maybeSingle(),
    ]);

    const fallbackVersion =
      type === 'terms' ? DEFAULT_TERMS_VERSION : DEFAULT_PRIVACY_VERSION;
    const fallbackContent =
      type === 'terms' ? DEFAULT_TERMS_CONTENT : DEFAULT_PRIVACY_CONTENT;

    const versionRaw = versionRes.data?.value;
    const version =
      typeof versionRaw === 'string' && versionRaw.trim()
        ? versionRaw.trim()
        : fallbackVersion;

    const contentRaw = contentRes.data?.value;
    const content =
      typeof contentRaw === 'string' && contentRaw.trim()
        ? contentRaw
        : interpolateLegalTemplate(fallbackContent, version);

    return NextResponse.json({
      type,
      version,
      content,
      updated_at: contentRes.data?.updated_at ?? null,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
