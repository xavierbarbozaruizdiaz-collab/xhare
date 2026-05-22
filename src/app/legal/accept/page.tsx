'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';

type LegalDocResponse = { version?: string };

async function fetchVersion(type: 'terms' | 'privacy'): Promise<string> {
  try {
    const res = await fetch(`/api/legal/document?type=${type}`);
    if (!res.ok) return 'v1.0';
    const json = (await res.json()) as LegalDocResponse;
    return typeof json.version === 'string' && json.version.trim() ? json.version.trim() : 'v1.0';
  } catch {
    return 'v1.0';
  }
}

export default function LegalAcceptPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [termsVersion, setTermsVersion] = useState('v1.0');
  const [privacyVersion, setPrivacyVersion] = useState('v1.0');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        router.replace('/login?session_expired=1');
        return;
      }
      const [tv, pv] = await Promise.all([fetchVersion('terms'), fetchVersion('privacy')]);
      if (!cancelled) {
        setTermsVersion(tv);
        setPrivacyVersion(pv);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleAccept() {
    setSaving(true);
    setError('');
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        router.replace('/login?session_expired=1');
        return;
      }
      const res = await fetch('/api/legal/accept', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ source: 'web', termsVersion, privacyVersion }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error || 'No se pudo registrar la aceptación legal.');
      }
      router.replace('/app');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la aceptación legal.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-lg shadow p-6">
        <h1 className="text-2xl font-bold text-green-700 mb-2">Aceptación legal requerida</h1>
        <p className="text-sm text-gray-600 mb-5">
          Para continuar usando ÑandeBus tenés que aceptar los documentos legales vigentes.
        </p>
        <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1 mb-4">
          <li>
            TyC ({termsVersion}) —{' '}
            <Link href="/legal/terms" target="_blank" className="text-green-700 underline">
              leer documento
            </Link>
          </li>
          <li>
            Privacidad ({privacyVersion}) —{' '}
            <Link href="/legal/privacy" target="_blank" className="text-green-700 underline">
              leer documento
            </Link>
          </li>
        </ul>
        {error ? <p className="text-sm text-red-600 mb-3">{error}</p> : null}
        <button
          onClick={() => void handleAccept()}
          disabled={saving}
          className="w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-60"
        >
          {saving ? 'Guardando...' : 'Acepto y continuar'}
        </button>
      </div>
    </div>
  );
}
