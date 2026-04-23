'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useAdminAuth } from '../AdminAuthContext';

type GroupRow = {
  id: string;
  ride_id: string | null;
  base_trip_request_id: string | null;
  requested_date: string;
  requested_time: string | null;
  origin_city: string | null;
  origin_barrio: string | null;
  destination_city: string | null;
  destination_barrio: string | null;
  passenger_count: number | null;
  grouping_source: string | null;
  base_length_km: number | null;
  created_at?: string | null;
};

function formatDate(d: string | null | undefined): string {
  if (!d) return '—';
  return d;
}

export default function AdminDemandGroupsPage() {
  const { accessToken, ready, isAdmin, refetch } = useAdminAuth();
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(() => {
    const t = new Date();
    t.setDate(t.getDate() + 21);
    return t.toISOString().slice(0, 10);
  });
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setErr(null);
    try {
      let token = accessToken;
      let res = await fetch(`/api/admin/demand-groups?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        token = (await refetch()) ?? '';
        if (token) {
          res = await fetch(`/api/admin/demand-groups?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
            credentials: 'include',
            headers: { Authorization: `Bearer ${token}` },
          });
        }
      }
      const body = (await res.json()) as { groups?: GroupRow[]; error?: string };
      if (!res.ok) {
        setErr(typeof body.error === 'string' ? body.error : 'Error al cargar grupos');
        setGroups([]);
        return;
      }
      setGroups(body.groups ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error de red');
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, from, to, refetch]);

  useEffect(() => {
    if (!ready || !isAdmin || !accessToken) return;
    void load();
  }, [ready, isAdmin, accessToken, load]);

  if (!ready || !isAdmin) {
    return <div className="text-gray-500 text-sm py-8">Comprobando permisos…</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Grupos de demanda</h1>
        <p className="text-sm text-gray-600 mt-1 max-w-3xl">
          Listado de <code className="text-xs bg-gray-100 px-1 rounded">demand_route_groups</code>. Tocá un grupo para ver
          ruta, montos y pasajeros (mismo detalle que la app). Desde el detalle podés{' '}
          <strong>disolver el agrupamiento</strong> de forma controlada (no aplica si el viaje del grupo está publicado o
          en curso).
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex flex-wrap items-end gap-3">
        <label className="text-sm text-gray-700">
          Desde
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 block border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </label>
        <label className="text-sm text-gray-700">
          Hasta
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 block border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </label>
        <button
          type="button"
          className="btn-primary text-sm py-2 px-4 disabled:opacity-50"
          disabled={loading || !accessToken}
          onClick={() => void load()}
        >
          {loading ? 'Cargando…' : 'Actualizar'}
        </button>
      </div>

      {err && <p className="text-sm text-red-700">{err}</p>}

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-left text-gray-600">
              <tr>
                <th className="px-3 py-2 font-medium">Fecha</th>
                <th className="px-3 py-2 font-medium">Ruta</th>
                <th className="px-3 py-2 font-medium">Pasajeros</th>
                <th className="px-3 py-2 font-medium">Origen agrupación</th>
                <th className="px-3 py-2 font-medium">Ride sistema</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 && !loading ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-gray-500">
                    No hay grupos en el rango.
                  </td>
                </tr>
              ) : (
                groups.map((g) => (
                  <tr key={g.id} className="border-b border-gray-100 hover:bg-gray-50/80">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-800">
                      {formatDate(g.requested_date)} {g.requested_time ? `· ${g.requested_time}` : ''}
                    </td>
                    <td className="px-3 py-2 text-gray-900">
                      <span className="font-medium">{(g.origin_city ?? '—') + ' → ' + (g.destination_city ?? '—')}</span>
                      {g.origin_barrio || g.destination_barrio ? (
                        <div className="text-xs text-gray-500 mt-0.5">
                          {[g.origin_barrio, g.destination_barrio].filter(Boolean).join(' · ')}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">{g.passenger_count ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">{g.grouping_source ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{g.ride_id ? g.ride_id.slice(0, 8) + '…' : '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/admin/demand-groups/${g.id}`}
                        className="text-green-600 hover:text-green-700 font-medium"
                      >
                        Ver detalle
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
