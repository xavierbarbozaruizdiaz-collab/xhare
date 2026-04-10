'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAdminAuth } from '../AdminAuthContext';
import type { DispatchMapMarker } from '@/components/admin/AdminDispatchMap';

const AdminDispatchMap = dynamic(() => import('@/components/admin/AdminDispatchMap'), {
  ssr: false,
  loading: () => (
    <div className="min-h-[280px] flex items-center justify-center bg-gray-100 rounded-xl border border-gray-200 text-gray-500 text-sm">
      Cargando mapa…
    </div>
  ),
});

type TripRow = {
  id: string;
  origin_lat: number;
  origin_lng: number;
  destination_lat: number;
  destination_lng: number;
  origin_label: string | null;
  destination_label: string | null;
  requested_date: string;
  requested_time: string;
  status: string;
  pricing_kind: string | null;
  passenger_desired_price_per_seat_gs?: number | null;
};

type SystemRideRow = {
  id: string;
  origin_lat: number;
  origin_lng: number;
  destination_lat: number;
  destination_lng: number;
  origin_label: string | null;
  destination_label: string | null;
  departure_time: string;
  status: string;
  available_seats: number | null;
  total_seats: number | null;
};

type GroupRow = {
  id: string;
  origin_city: string | null;
  destination_city: string | null;
  requested_date: string;
  requested_time: string;
  passenger_count: number;
  ride_id: string | null;
  base_trip_request_id: string | null;
};

type RouteStop = { key: string; lat: number; lng: number; label: string };

const COL = {
  intOrig: '#14532d',
  intDest: '#22c55e',
  longOrig: '#1e3a8a',
  longDest: '#60a5fa',
  sysOrig: '#6b21a8',
  sysDest: '#c084fc',
};

function isLong(t: TripRow): boolean {
  return t.pricing_kind === 'long_distance';
}

function fmtWhen(d: string, t: string): string {
  const date = new Date(d + 'T12:00:00').toLocaleDateString('es-PY', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const m = String(t ?? '').match(/^(\d{1,2}):(\d{2})/);
  const time = m ? `${m[1].padStart(2, '0')}:${m[2]}` : String(t ?? '—');
  return `${date} · ${time}`;
}

export default function AdminDispatchMapPage() {
  const { accessToken, ready, isAdmin, refetch } = useAdminAuth();
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(() => {
    const u = new Date();
    u.setDate(u.getDate() + 14);
    return u.toISOString().slice(0, 10);
  });
  const [showInternal, setShowInternal] = useState(true);
  const [showLong, setShowLong] = useState(true);
  const [showSystem, setShowSystem] = useState(true);
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [rides, setRides] = useState<SystemRideRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [routeStops, setRouteStops] = useState<RouteStop[]>([]);
  const [actingGroup, setActingGroup] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const load = useCallback(
    async (tokenOverride?: string | null) => {
      const initial = tokenOverride ?? accessToken;
      if (!initial) return;
      setLoading(true);
      setErr(null);
      try {
        let token = initial;
        let res = await fetch(`/api/admin/dispatch-map-data?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 401) {
          token = (await refetch()) ?? '';
          if (token) {
            res = await fetch(`/api/admin/dispatch-map-data?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
              credentials: 'include',
              headers: { Authorization: `Bearer ${token}` },
            });
          }
        }
      const body = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setErr(typeof body.error === 'string' ? body.error : 'No se pudo cargar');
        setTrips([]);
        setRides([]);
        setGroups([]);
        return;
      }
      setTrips((body.tripRequests as TripRow[]) ?? []);
      setRides((body.systemRides as SystemRideRow[]) ?? []);
      setGroups((body.demandGroups as GroupRow[]) ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error de red');
    } finally {
      setLoading(false);
    }
  },
  [accessToken, from, to, refetch]);

  useEffect(() => {
    if (!ready || !isAdmin) return;
    (async () => {
      let token = accessToken;
      if (!token) {
        token = (await refetch()) ?? null;
      }
      if (!token) return;
      await load(token);
    })();
    // Carga inicial al entrar; cambiar fechas y pulsar «Actualizar datos».
    // eslint-disable-next-line react-hooks/exhaustive-deps -- evitar refetch en cada tecla en from/to
  }, [ready, isAdmin, accessToken]);

  const markers = useMemo((): DispatchMapMarker[] => {
    const out: DispatchMapMarker[] = [];
    for (const tr of trips) {
      const long = isLong(tr);
      if (long && !showLong) continue;
      if (!long && !showInternal) continue;
      const when = fmtWhen(tr.requested_date, tr.requested_time);
      const kind = long ? 'Larga distancia' : 'Interno';
      out.push({
        id: `${tr.id}-o`,
        lat: Number(tr.origin_lat),
        lng: Number(tr.origin_lng),
        color: long ? COL.longOrig : COL.intOrig,
        title: `Origen · ${kind}`,
        subtitle: `${when} · ${(tr.origin_label ?? 'Origen').slice(0, 48)} → ${(tr.destination_label ?? 'Destino').slice(0, 48)} · status ${tr.status}`,
      });
      out.push({
        id: `${tr.id}-d`,
        lat: Number(tr.destination_lat),
        lng: Number(tr.destination_lng),
        color: long ? COL.longDest : COL.intDest,
        title: `Destino · ${kind}`,
        subtitle: `${when} · pedido ${tr.id.slice(0, 8)}…`,
      });
    }
    if (showSystem) {
      for (const r of rides) {
        const when = new Date(r.departure_time).toLocaleString('es-PY', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        });
        out.push({
          id: `${r.id}-o`,
          lat: Number(r.origin_lat),
          lng: Number(r.origin_lng),
          color: COL.sysOrig,
          title: 'Origen · Generado por sistema',
          subtitle: `${when} · ${(r.origin_label ?? '').slice(0, 40)} → ${(r.destination_label ?? '').slice(0, 40)}`,
        });
        out.push({
          id: `${r.id}-d`,
          lat: Number(r.destination_lat),
          lng: Number(r.destination_lng),
          color: COL.sysDest,
          title: 'Destino · Generado por sistema',
          subtitle: `${when} · ride ${r.id.slice(0, 8)}… · cupo ${r.available_seats ?? r.total_seats ?? '—'}`,
        });
      }
    }
    return out;
  }, [trips, rides, showInternal, showLong, showSystem]);

  const appendStop = useCallback((m: DispatchMapMarker) => {
    setRouteStops((prev) => [
      ...prev,
      { key: `${m.id}-${prev.length}`, lat: m.lat, lng: m.lng, label: `${m.title}: ${m.subtitle.slice(0, 80)}` },
    ]);
  }, []);

  const moveStop = useCallback((index: number, dir: -1 | 1) => {
    setRouteStops((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      const t = next[index]!;
      next[index] = next[j]!;
      next[j] = t;
      return next;
    });
  }, []);

  const removeStop = useCallback((index: number) => {
    setRouteStops((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearRoute = useCallback(() => setRouteStops([]), []);

  const routePoints = useMemo(() => routeStops.map((s) => ({ lat: s.lat, lng: s.lng })), [routeStops]);

  const createFromGroup = useCallback(
    async (groupId: string) => {
      if (!accessToken) return;
      setActingGroup(groupId);
      setActionMsg(null);
      let token = accessToken;
      try {
        let res = await fetch('/api/rides/create-from-group', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ group_id: groupId }),
        });
        if (res.status === 401) {
          token = (await refetch()) ?? '';
          if (token) {
            res = await fetch('/api/rides/create-from-group', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ group_id: groupId }),
            });
          }
        }
        const body = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          setActionMsg(typeof body.error === 'string' ? body.error : `Error ${res.status}`);
          return;
        }
        setActionMsg(
          body.already ? 'Este grupo ya tenía viaje generado.' : `Viaje generado: ${String(body.ride_id ?? '')}`
        );
        await load();
      } catch (e) {
        setActionMsg(e instanceof Error ? e.message : 'Error');
      } finally {
        setActingGroup(null);
      }
    },
    [accessToken, refetch, load]
  );

  if (!ready) {
    return <p className="text-gray-500">Cargando…</p>;
  }
  if (!isAdmin) {
    return null;
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mapa de despacho</h1>
          <p className="text-gray-600 text-sm mt-1">
            Pedidos en el mapa (origen y destino), filtros por tipo, grupos de demanda y creación de viaje por sistema.
          </p>
        </div>
        <Link href="/admin" className="text-sm text-green-600 hover:underline font-medium">
          ← Volver al inicio admin
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Desde</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Hasta</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <button type="button" onClick={() => void load()} className="btn-primary text-sm py-2 px-4" disabled={loading}>
          {loading ? 'Cargando…' : 'Actualizar datos'}
        </button>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={showInternal} onChange={(e) => setShowInternal(e.target.checked)} />
          <span className="font-medium text-gray-800">Internos</span>
          <span className="w-3 h-3 rounded-full" style={{ background: COL.intOrig }} />
        </label>
        <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={showLong} onChange={(e) => setShowLong(e.target.checked)} />
          <span className="font-medium text-gray-800">Larga distancia</span>
          <span className="w-3 h-3 rounded-full" style={{ background: COL.longOrig }} />
        </label>
        <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} />
          <span className="font-medium text-gray-800">Generados por sistema</span>
          <span className="w-3 h-3 rounded-full" style={{ background: COL.sysOrig }} />
        </label>
      </div>

      {err && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>
      )}
      {actionMsg && (
        <div className="mb-4 text-sm text-gray-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{actionMsg}</div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 order-2 xl:order-1">
          <AdminDispatchMap markers={markers} routePoints={routePoints} onMarkerDoubleClick={appendStop} height="min(70vh, 560px)" />
          <p className="text-xs text-gray-500 mt-2">
            <strong>Ruta manual:</strong> doble clic en un punto del mapa para encadenarlo. La línea verde une las paradas en orden.
          </p>
        </div>
        <div className="space-y-4 order-1 xl:order-2 max-h-[85vh] overflow-y-auto pr-1">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="font-semibold text-gray-900 mb-2">Paradas de la ruta ({routeStops.length})</h2>
            {routeStops.length === 0 ? (
              <p className="text-sm text-gray-500">Todavía no añadiste puntos. Usá doble clic en el mapa.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {routeStops.map((s, i) => (
                  <li key={s.key} className="flex flex-col gap-1 border-b border-gray-100 pb-2">
                    <span className="text-gray-700 font-medium">
                      {i + 1}. {s.label.slice(0, 120)}
                      {s.label.length > 120 ? '…' : ''}
                    </span>
                    <div className="flex gap-2">
                      <button type="button" className="text-xs text-gray-600 underline" onClick={() => moveStop(i, -1)} disabled={i === 0}>
                        Subir
                      </button>
                      <button
                        type="button"
                        className="text-xs text-gray-600 underline"
                        onClick={() => moveStop(i, 1)}
                        disabled={i === routeStops.length - 1}
                      >
                        Bajar
                      </button>
                      <button type="button" className="text-xs text-red-600 underline" onClick={() => removeStop(i)}>
                        Quitar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={clearRoute}
              className="mt-3 text-sm text-gray-700 border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50"
              disabled={routeStops.length === 0}
            >
              Limpiar ruta
            </button>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="font-semibold text-gray-900 mb-2">Grupos de demanda ({groups.length})</h2>
            <p className="text-xs text-gray-500 mb-3">
              Si el grupo tiene solicitudes en estado agrupado, podés generar el viaje del sistema desde aquí.
            </p>
            {groups.length === 0 ? (
              <p className="text-sm text-gray-500">No hay grupos en el rango de fechas.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {groups.map((g) => (
                  <li key={g.id} className="border border-gray-100 rounded-lg p-3">
                    <div className="font-medium text-gray-900">
                      {(g.origin_city ?? 'Origen') + ' → ' + (g.destination_city ?? 'Destino')}
                    </div>
                    <div className="text-gray-600 mt-1">
                      {fmtWhen(g.requested_date, g.requested_time)} · {g.passenger_count} pasajero(s)
                    </div>
                    {g.ride_id ? (
                      <span className="inline-block mt-2 text-xs font-semibold text-green-700">Ya tiene viaje: {g.ride_id.slice(0, 8)}…</span>
                    ) : (
                      <button
                        type="button"
                        className="mt-2 btn-primary text-xs py-1.5 px-3"
                        disabled={actingGroup === g.id}
                        onClick={() => void createFromGroup(g.id)}
                      >
                        {actingGroup === g.id ? 'Generando…' : 'Generar viaje desde grupo'}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
