'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAdminAuth } from '../AdminAuthContext';

type LegalEvent = {
  id: string;
  user_id: string;
  source: 'web' | 'mobile';
  terms_version: string;
  privacy_version: string;
  accepted_at: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  profile?: {
    full_name: string | null;
    email: string | null;
  };
};

type LegalEventsResponse = {
  limit: number;
  offset: number;
  count: number;
  events: LegalEvent[];
};

export default function AdminLegalAuditPage() {
  const { accessToken, ready, isAdmin, refetch } = useAdminAuth();
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<LegalEvent[]>([]);
  const [count, setCount] = useState(0);
  const [offset, setOffset] = useState(0);
  const [source, setSource] = useState<'all' | 'web' | 'mobile'>('all');
  const [error, setError] = useState('');
  const limit = 30;

  const totalPages = useMemo(() => Math.max(1, Math.ceil(count / limit)), [count]);
  const currentPage = useMemo(() => Math.floor(offset / limit) + 1, [offset]);

  function csvEscape(value: unknown): string {
    const text = String(value ?? '');
    if (text.includes('"') || text.includes(',') || text.includes('\n') || text.includes('\r')) {
      return `"${text.replaceAll('"', '""')}"`;
    }
    return text;
  }

  function exportCsv() {
    if (!events.length) return;
    const headers = [
      'accepted_at',
      'user_id',
      'full_name',
      'email',
      'source',
      'terms_version',
      'privacy_version',
      'ip',
      'user_agent',
      'created_at',
    ];
    const lines = [
      headers.join(','),
      ...events.map((ev) =>
        [
          csvEscape(ev.accepted_at),
          csvEscape(ev.user_id),
          csvEscape(ev.profile?.full_name ?? ''),
          csvEscape(ev.profile?.email ?? ''),
          csvEscape(ev.source),
          csvEscape(ev.terms_version),
          csvEscape(ev.privacy_version),
          csvEscape(ev.ip ?? ''),
          csvEscape(ev.user_agent ?? ''),
          csvEscape(ev.created_at),
        ].join(',')
      ),
    ];
    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const sourceSuffix = source === 'all' ? 'all' : source;
    const dateTag = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `legal-audit-${sourceSuffix}-p${currentPage}-${dateTag}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    if (!ready || !isAdmin) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, isAdmin, offset, source, accessToken]);

  async function load() {
    if (!isAdmin) return;
    setLoading(true);
    setError('');
    let token = accessToken;
    if (!token) token = await refetch();
    if (!token) {
      setLoading(false);
      setError('No se pudo autenticar sesión de admin.');
      return;
    }

    const params = new URLSearchParams();
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    if (source !== 'all') params.set('source', source);

    const endpoint = `/api/admin/legal-acceptance-events?${params.toString()}`;
    const doFetch = async (bearer: string) =>
      fetch(endpoint, {
        headers: { Authorization: `Bearer ${bearer}` },
      });
    let res = await doFetch(token);
    if (res.status === 401) {
      const refreshed = await refetch();
      if (refreshed) res = await doFetch(refreshed);
    }
    const json = (await res.json().catch(() => ({}))) as
      | LegalEventsResponse
      | { error?: string };
    if (!res.ok) {
      setError((json as { error?: string }).error ?? `Error HTTP ${res.status}`);
      setLoading(false);
      return;
    }
    const payload = json as LegalEventsResponse;
    setEvents(Array.isArray(payload.events) ? payload.events : []);
    setCount(Number(payload.count ?? 0) || 0);
    setLoading(false);
  }

  if (!ready) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <p className="text-gray-700">Acceso restringido a administradores.</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Auditoría legal</h1>
      <p className="text-gray-600 mb-6">
        Registro probatorio de aceptación de TyC y Privacidad (fuente, versión, IP y agente).
      </p>

      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap items-center gap-3">
        <label className="text-sm text-gray-700">Fuente:</label>
        <select
          value={source}
          onChange={(e) => {
            setOffset(0);
            setSource(e.target.value as 'all' | 'web' | 'mobile');
          }}
          className="px-2 py-1 border border-gray-300 rounded"
        >
          <option value="all">Todas</option>
          <option value="web">Web</option>
          <option value="mobile">Mobile</option>
        </select>
        <button
          onClick={() => void load()}
          className="px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700"
          type="button"
        >
          Recargar
        </button>
        <button
          onClick={exportCsv}
          disabled={events.length === 0}
          className="px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
          type="button"
        >
          Exportar CSV
        </button>
        <span className="text-sm text-gray-500">
          {count} evento(s) · página {currentPage}/{totalPages}
        </span>
      </div>

      {error ? (
        <div className="mb-4 p-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600" />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 font-medium text-gray-700">Fecha</th>
                  <th className="px-4 py-3 font-medium text-gray-700">Usuario</th>
                  <th className="px-4 py-3 font-medium text-gray-700">Fuente</th>
                  <th className="px-4 py-3 font-medium text-gray-700">Versiones</th>
                  <th className="px-4 py-3 font-medium text-gray-700">IP</th>
                  <th className="px-4 py-3 font-medium text-gray-700">User-Agent</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id} className="border-b border-gray-100 align-top">
                    <td className="px-4 py-3 whitespace-nowrap">
                      {new Date(ev.accepted_at).toLocaleString('es-PY')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">
                        {ev.profile?.full_name || '—'}
                      </div>
                      <div className="text-xs text-gray-500">{ev.profile?.email || ev.user_id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700">
                        {ev.source}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700">
                      <div>TyC: {ev.terms_version}</div>
                      <div>Privacidad: {ev.privacy_version}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{ev.ip || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-600 max-w-[360px] break-words">
                      {ev.user_agent || '—'}
                    </td>
                  </tr>
                ))}
                {events.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                      Sin eventos para el filtro actual.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="p-3 border-t border-gray-200 flex items-center justify-between">
            <button
              type="button"
              disabled={offset <= 0}
              onClick={() => setOffset((v) => Math.max(0, v - limit))}
              className="px-3 py-1.5 border rounded disabled:opacity-50"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={offset + limit >= count}
              onClick={() => setOffset((v) => v + limit)}
              className="px-3 py-1.5 border rounded disabled:opacity-50"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
