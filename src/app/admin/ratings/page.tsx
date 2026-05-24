'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAdminAuth } from '../AdminAuthContext';

type DriverRatingRow = {
  id: string;
  ride_id: string;
  stars: number;
  comment: string | null;
  created_at: string;
  driver: { full_name: string | null };
  passenger: { full_name: string | null };
};

type FeedbackResponse = {
  limit: number;
  offset: number;
  count: number;
  ratings: DriverRatingRow[];
};

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('es-PY', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

function starsLabel(n: number) {
  return '★'.repeat(Math.max(0, Math.min(5, n))) + '☆'.repeat(Math.max(0, 5 - Math.min(5, n)));
}

export default function AdminRatingsPage() {
  const { accessToken, ready, isAdmin, refetch } = useAdminAuth();
  const [loading, setLoading] = useState(true);
  const [ratings, setRatings] = useState<DriverRatingRow[]>([]);
  const [count, setCount] = useState(0);
  const [offset, setOffset] = useState(0);
  const [onlyWithComment, setOnlyWithComment] = useState(false);
  const [error, setError] = useState('');
  const limit = 30;

  const totalPages = useMemo(() => Math.max(1, Math.ceil(count / limit)), [count]);
  const currentPage = useMemo(() => Math.floor(offset / limit) + 1, [offset]);

  useEffect(() => {
    if (!ready || !isAdmin) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, isAdmin, offset, onlyWithComment, accessToken]);

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
    if (onlyWithComment) params.set('with_comment', '1');

    const endpoint = `/api/admin/ratings/feedback?${params.toString()}`;
    const doFetch = async (bearer: string) =>
      fetch(endpoint, { headers: { Authorization: `Bearer ${bearer}` } });
    let res = await doFetch(token);
    if (res.status === 401) {
      const refreshed = await refetch();
      if (refreshed) res = await doFetch(refreshed);
    }
    const json = (await res.json().catch(() => ({}))) as FeedbackResponse | { error?: string };
    if (!res.ok) {
      setError((json as { error?: string }).error ?? `Error HTTP ${res.status}`);
      setLoading(false);
      return;
    }
    const payload = json as FeedbackResponse;
    setRatings(Array.isArray(payload.ratings) ? payload.ratings : []);
    setCount(Number(payload.count ?? 0) || 0);
    setLoading(false);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Calificaciones a conductores</h1>
      <p className="text-sm text-gray-600 mb-6">
        Comentarios y estrellas que los pasajeros dejan al conductor tras el viaje.
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={onlyWithComment}
            onChange={(e) => {
              setOffset(0);
              setOnlyWithComment(e.target.checked);
            }}
            className="rounded border-gray-300"
          />
          Solo con comentario
        </label>
      </div>

      {error ? (
        <p className="text-red-600 text-sm mb-4">{error}</p>
      ) : null}

      {loading ? (
        <p className="text-gray-500">Cargando…</p>
      ) : ratings.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
          No hay calificaciones{onlyWithComment ? ' con comentario' : ''} para mostrar.
        </div>
      ) : (
        <ul className="space-y-3">
          {ratings.map((r) => (
            <li key={r.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                <div>
                  <p className="font-semibold text-gray-900">
                    Conductor: {r.driver.full_name?.trim() || '—'}
                  </p>
                  <p className="text-sm text-gray-600">
                    Pasajero: {r.passenger.full_name?.trim() || '—'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-amber-600 font-medium" title={`${r.stars} estrellas`}>
                    {starsLabel(r.stars)}
                  </p>
                  <p className="text-xs text-gray-500">{formatDate(r.created_at)}</p>
                </div>
              </div>
              {r.comment?.trim() ? (
                <p className="text-sm text-gray-800 whitespace-pre-wrap border-t border-gray-100 pt-3 mt-1">
                  {r.comment.trim()}
                </p>
              ) : (
                <p className="text-sm text-gray-400 italic border-t border-gray-100 pt-3 mt-1">
                  Sin comentario
                </p>
              )}
              <p className="text-xs text-gray-500 mt-2">
                Viaje:{' '}
                <Link href={`/rides/${r.ride_id}`} className="text-green-700 hover:underline">
                  {r.ride_id.slice(0, 8)}…
                </Link>
              </p>
            </li>
          ))}
        </ul>
      )}

      {count > limit ? (
        <div className="flex items-center justify-between mt-6">
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={offset <= 0 || loading}
            onClick={() => setOffset((o) => Math.max(0, o - limit))}
          >
            Anterior
          </button>
          <span className="text-sm text-gray-600">
            Página {currentPage} de {totalPages}
          </span>
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={offset + limit >= count || loading}
            onClick={() => setOffset((o) => o + limit)}
          >
            Siguiente
          </button>
        </div>
      ) : null}
    </div>
  );
}
