'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import { useAdminAuth } from '../AdminAuthContext';

type RideStatus =
  | 'draft'
  | 'awaiting_driver'
  | 'published'
  | 'booked'
  | 'en_route'
  | 'completed'
  | 'cancelled';

type Ride = {
  id: string;
  origin_label: string | null;
  destination_label: string | null;
  departure_time: string | null;
  status: string;
  available_seats: number | null;
  total_seats: number | null;
  price_per_seat: number | null;
  created_at: string | null;
  driver_id: string | null;
  driver?: { full_name: string | null } | null;
};

const STATUS_FILTERS: { value: 'all' | RideStatus; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'en_route', label: 'En curso' },
  { value: 'booked', label: 'Reservado' },
  { value: 'published', label: 'Publicado' },
  { value: 'awaiting_driver', label: 'Esperando chofer' },
  { value: 'completed', label: 'Finalizado' },
  { value: 'cancelled', label: 'Cancelado' },
  { value: 'draft', label: 'Borrador' },
];

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: 'Borrador',
    awaiting_driver: 'Esperando chofer',
    published: 'Publicado',
    booked: 'Reservado',
    en_route: 'En curso',
    completed: 'Finalizado',
    cancelled: 'Cancelado',
  };
  return map[status] ?? status;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'en_route':
      return 'bg-amber-100 text-amber-900 ring-1 ring-amber-300';
    case 'completed':
      return 'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200';
    case 'cancelled':
      return 'bg-red-100 text-red-900 ring-1 ring-red-200';
    case 'published':
      return 'bg-sky-100 text-sky-900 ring-1 ring-sky-200';
    case 'booked':
      return 'bg-violet-100 text-violet-900 ring-1 ring-violet-200';
    case 'awaiting_driver':
      return 'bg-orange-100 text-orange-900 ring-1 ring-orange-200';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

export default function AdminRidesPage() {
  const { accessToken, ready, isAdmin, refetch } = useAdminAuth();
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [forceCompletingId, setForceCompletingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | RideStatus>('all');
  const [search, setSearch] = useState('');

  const loadRides = useCallback(async () => {
    let q = supabase
      .from('rides')
      .select(
        `
          id,
          origin_label,
          destination_label,
          departure_time,
          status,
          available_seats,
          total_seats,
          price_per_seat,
          created_at,
          driver_id,
          driver:profiles!rides_driver_id_fkey(full_name)
        `
      )
      .order('departure_time', { ascending: false })
      .limit(400);

    if (statusFilter !== 'all') {
      q = q.eq('status', statusFilter);
    }

    const { data, error } = await q;
    if (error) {
      console.error('[admin/rides] load', error);
      setRides([]);
      return;
    }
    const rows = data ?? [];
    const normalized: Ride[] = rows.map((row: any) => {
      const rawDriver = row.driver;
      const driver = Array.isArray(rawDriver) ? rawDriver[0] ?? null : rawDriver ?? null;
      return {
        id: row.id,
        origin_label: row.origin_label ?? null,
        destination_label: row.destination_label ?? null,
        departure_time: row.departure_time ?? null,
        status: row.status ?? 'draft',
        available_seats: row.available_seats ?? null,
        total_seats: row.total_seats ?? null,
        price_per_seat: row.price_per_seat ?? null,
        created_at: row.created_at ?? null,
        driver_id: row.driver_id ?? null,
        driver:
          driver && typeof driver === 'object' && 'full_name' in driver
            ? { full_name: (driver as { full_name?: string | null }).full_name ?? null }
            : null,
      };
    });
    setRides(normalized);
  }, [statusFilter]);

  useEffect(() => {
    if (!ready || !isAdmin) return;
    setLoading(true);
    void loadRides().finally(() => setLoading(false));
  }, [ready, isAdmin, loadRides]);

  const handleDelete = async (rideId: string, status: string) => {
    const extra =
      status === 'en_route'
        ? '\n\nEste viaje está EN CURSO. Preferí “Forzar finalizado” si querés cerrarlo sin borrar el historial.'
        : '';
    if (!confirm(`¿Eliminar este viaje? Se borrarán también las reservas asociadas.${extra}`)) return;
    setDeletingId(rideId);
    const { error } = await supabase.from('rides').delete().eq('id', rideId);
    setDeletingId(null);
    if (error) {
      alert('No se pudo eliminar el viaje: ' + error.message);
      return;
    }
    setRides((prev) => prev.filter((r) => r.id !== rideId));
  };

  const handleForceComplete = async (rideId: string) => {
    if (!accessToken) {
      alert('No hay sesión. Recargá la página e intentá de nuevo.');
      return;
    }
    if (
      !confirm(
        '¿Forzar finalizado? El viaje pasará a “Finalizado”, se limpiará la ubicación del conductor en vivo y las reservas activas se marcarán como completadas (según reglas del sistema).'
      )
    ) {
      return;
    }
    setForceCompletingId(rideId);
    const refreshed = await supabase.auth.refreshSession();
    let token =
      refreshed.data.session?.access_token ??
      (await supabase.auth.getSession()).data.session?.access_token ??
      accessToken;
    if (!token) {
      setForceCompletingId(null);
      alert('No hay sesión. Recargá la página e intentá de nuevo.');
      return;
    }
    const postBody = () =>
      JSON.stringify({
        access_token: token,
      });
    let res = await fetch(`/api/admin/rides/${encodeURIComponent(rideId)}/force-complete`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: postBody(),
    });
    if (res.status === 401) {
      token = (await refetch()) ?? '';
      if (token) {
        res = await fetch(`/api/admin/rides/${encodeURIComponent(rideId)}/force-complete`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ access_token: token }),
        });
      }
    }
    setForceCompletingId(null);
    const body = (await res.json().catch(() => ({}))) as { error?: string; details?: string; ride?: { status?: string } };
    if (!res.ok) {
      const msg =
        typeof body.details === 'string'
          ? body.details
          : typeof body.error === 'string'
            ? body.error
            : 'No se pudo finalizar el viaje';
      alert(msg);
      return;
    }
    setRides((prev) => {
      if (statusFilter === 'en_route') {
        return prev.filter((x) => x.id !== rideId);
      }
      return prev.map((r) => (r.id === rideId ? { ...r, status: body.ride?.status ?? 'completed' } : r));
    });
  };

  const searchTrim = search.trim().toLowerCase();
  const filteredRides =
    searchTrim.length === 0
      ? rides
      : rides.filter((r) => {
          const hay = [
            r.id,
            r.origin_label,
            r.destination_label,
            r.driver?.full_name,
            r.status,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return hay.includes(searchTrim);
        });

  if (!ready || !isAdmin) {
    return <div className="text-gray-500 text-sm py-8">Comprobando permisos…</div>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Viajes</h1>
      <p className="text-gray-600 mb-4">
        Viajes publicados en la aplicación. Filtrá por estado; en <strong>En curso</strong> podés forzar el cierre si el
        conductor no terminó el viaje.
      </p>

      <div className="flex flex-col gap-4 mb-6">
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatusFilter(value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                statusFilter === value
                  ? 'bg-green-600 text-white border-green-600'
                  : 'bg-white text-gray-700 border-gray-200 hover:border-green-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div>
          <label htmlFor="admin-rides-search" className="sr-only">
            Buscar
          </label>
          <input
            id="admin-rides-search"
            type="search"
            placeholder="Buscar por ID, ruta, conductor o estado…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-md px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600" />
        </div>
      ) : rides.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
          No hay viajes{statusFilter !== 'all' ? ' con este filtro' : ''}.
        </div>
      ) : filteredRides.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
          Ningún viaje coincide con la búsqueda.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-left min-w-[720px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-sm font-medium text-gray-700">Origen → Destino</th>
                <th className="px-4 py-3 text-sm font-medium text-gray-700">Salida</th>
                <th className="px-4 py-3 text-sm font-medium text-gray-700">Chofer</th>
                <th className="px-4 py-3 text-sm font-medium text-gray-700">Asientos</th>
                <th className="px-4 py-3 text-sm font-medium text-gray-700">Estado</th>
                <th className="px-4 py-3 text-sm font-medium text-gray-700 min-w-[200px]">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredRides.map((r) => (
                <tr
                  key={r.id}
                  className={`border-b border-gray-100 ${r.status === 'en_route' ? 'bg-amber-50/60' : ''}`}
                >
                  <td className="px-4 py-3">
                    <div className="text-xs text-gray-500 font-mono mb-0.5">{r.id.slice(0, 8)}…</div>
                    <Link href={`/rides/${r.id}`} className="text-green-700 hover:underline font-medium">
                      {r.origin_label ?? '—'} → {r.destination_label ?? '—'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap">
                    {r.departure_time ? new Date(r.departure_time).toLocaleString('es-PY') : '—'}
                  </td>
                  <td className="px-4 py-3">{r.driver?.full_name ?? '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {r.available_seats ?? 0}/{r.total_seats ?? 0}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${statusBadgeClass(r.status)}`}>
                      {statusLabel(r.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                      {r.status === 'en_route' ? (
                        <button
                          type="button"
                          onClick={() => void handleForceComplete(r.id)}
                          disabled={forceCompletingId === r.id}
                          className="text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md px-2 py-1 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                        >
                          {forceCompletingId === r.id ? 'Finalizando…' : 'Forzar finalizado'}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void handleDelete(r.id, r.status)}
                        disabled={deletingId === r.id}
                        className="text-red-600 hover:text-red-800 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                        title="Eliminar viaje"
                      >
                        {deletingId === r.id ? 'Eliminando…' : 'Eliminar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-gray-500 px-4 py-2 border-t border-gray-100 bg-gray-50">
            Mostrando hasta 400 viajes por consulta (orden por fecha de salida). Usá filtros o la búsqueda para acotar.
          </p>
        </div>
      )}
    </div>
  );
}
