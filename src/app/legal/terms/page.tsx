import { createServiceClient } from '@/lib/supabase/server';
import {
  DEFAULT_TERMS_CONTENT,
  DEFAULT_TERMS_VERSION,
  interpolateLegalTemplate,
  LEGAL_SETTINGS_KEYS,
} from '@/lib/legal-documents';

export const dynamic = 'force-dynamic';

function renderLines(text: string) {
  return text.split('\n').map((line, idx) => (
    <p key={`${idx}-${line.slice(0, 12)}`} className="mb-3 whitespace-pre-wrap">
      {line}
    </p>
  ));
}

export default async function TermsPage() {
  const service = createServiceClient();
  const [contentRes, versionRes] = await Promise.all([
    service
      .from('settings')
      .select('value, updated_at')
      .eq('key', LEGAL_SETTINGS_KEYS.termsContent)
      .maybeSingle(),
    service
      .from('settings')
      .select('value')
      .eq('key', LEGAL_SETTINGS_KEYS.termsVersion)
      .maybeSingle(),
  ]);

  const versionRaw = versionRes.data?.value;
  const version =
    typeof versionRaw === 'string' && versionRaw.trim()
      ? versionRaw.trim()
      : DEFAULT_TERMS_VERSION;
  const contentRaw = contentRes.data?.value;
  const content =
    typeof contentRaw === 'string' && contentRaw.trim()
      ? contentRaw
      : interpolateLegalTemplate(DEFAULT_TERMS_CONTENT, version);

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">
        Términos y Condiciones
      </h1>
      <p className="text-sm text-gray-600 mb-6">
        Versión: {version}
        {contentRes.data?.updated_at ? ` • Actualizado: ${new Date(contentRes.data.updated_at).toLocaleDateString('es-PY')}` : ''}
      </p>
      <article className="text-sm text-gray-800 leading-6">{renderLines(content)}</article>
    </main>
  );
}
