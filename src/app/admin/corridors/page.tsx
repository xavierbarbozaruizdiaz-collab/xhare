'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useAdminAuth } from '../AdminAuthContext';
import type {
  CorridorLayerVisibility,
  CorridorZoneEditPayload,
  DemandTubeLayer,
} from '@/components/admin/AdminCorridorsMap';

const AdminCorridorsMap = dynamic(() => import('@/components/admin/AdminCorridorsMap'), {
  ssr: false,
  loading: () => (
    <div className="min-h-[280px] flex items-center justify-center bg-gray-100 rounded-xl border border-gray-200 text-gray-500 text-sm">
      Cargando mapa…
    </div>
  ),
});

type CorridorZone = {
  minLat?: unknown;
  maxLat?: unknown;
  minLng?: unknown;
  maxLng?: unknown;
};

type CorridorRow = {
  id: string;
  name: string;
  slug: string;
  origin_zone: Record<string, unknown>;
  destination_zone: Record<string, unknown>;
  sort_priority: number;
  is_active: boolean;
  created_at: string;
};

function zoneSummary(z: Record<string, unknown>): string {
  const o = z as CorridorZone;
  const a = [o.minLat, o.maxLat, o.minLng, o.maxLng].every((x) => typeof x === 'number' || typeof x === 'string');
  if (!a) return JSON.stringify(z);
  return `lat ${o.minLat} … ${o.maxLat}, lng ${o.minLng} … ${o.maxLng}`;
}

export default function AdminCorridorsPage() {
  const { accessToken, ready, isAdmin, refetch } = useAdminAuth();
  const [rows, setRows] = useState<CorridorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<CorridorLayerVisibility>({});
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tubeFrom, setTubeFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [tubeTo, setTubeTo] = useState(() => {
    const u = new Date();
    u.setDate(u.getDate() + 14);
    return u.toISOString().slice(0, 10);
  });
  const [demandTubes, setDemandTubes] = useState<DemandTubeLayer[]>([]);
  const [showDemandTubes, setShowDemandTubes] = useState(true);
  const [tubesLoading, setTubesLoading] = useState(false);
  const [tubesErr, setTubesErr] = useState<string | null>(null);
  const [tubesMeta, setTubesMeta] = useState<{
    groupsInRange: number;
    tubesDrawn: number;
    axisFallback: number;
  } | null>(null);
  const [corridorOutlineOnly, setCorridorOutlineOnly] = useState(false);

  const load = useCallback(async () => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      let token = accessToken;
      let res = await fetch('/api/admin/corridors', {
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        token = (await refetch()) ?? '';
        if (token) {
          res = await fetch('/api/admin/corridors', {
            credentials: 'include',
            headers: { Authorization: `Bearer ${token}` },
          });
        }
      }
      const body = (await res.json()) as { corridors?: CorridorRow[]; error?: string };
      if (!res.ok) {
        setErr(typeof body.error === 'string' ? body.error : 'No se pudo cargar');
        setRows([]);
        return;
      }
      setRows(body.corridors ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error de red');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, refetch]);

  useEffect(() => {
    if (!ready || !isAdmin) return;
    void load();
  }, [ready, isAdmin, load]);

  const loadTubes = useCallback(async () => {
    if (!showDemandTubes) {
      setDemandTubes([]);
      setTubesMeta(null);
      return;
    }
    if (!accessToken) return;
    setTubesErr(null);
    setTubesLoading(true);
    try {
      let token = accessToken;
      let res = await fetch(
        `/api/admin/demand-route-tubes?from=${encodeURIComponent(tubeFrom)}&to=${encodeURIComponent(tubeTo)}`,
        { credentials: 'include', headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.status === 401) {
        token = (await refetch()) ?? '';
        if (token) {
          res = await fetch(
            `/api/admin/demand-route-tubes?from=${encodeURIComponent(tubeFrom)}&to=${encodeURIComponent(tubeTo)}`,
            { credentials: 'include', headers: { Authorization: `Bearer ${token}` } }
          );
        }
      }
      const body = (await res.json()) as {
        tubes?: DemandTubeLayer[];
        error?: string;
        groups_in_range?: number;
        tubes_drawn?: number;
        tubes_axis_fallback?: number;
      };
      if (!res.ok) {
        setTubesErr(typeof body.error === 'string' ? body.error : 'No se pudieron cargar los tubos');
        setDemandTubes([]);
        setTubesMeta(null);
        return;
      }
      const list = body.tubes ?? [];
      const drawn = typeof body.tubes_drawn === 'number' ? body.tubes_drawn : list.length;
      setTubesMeta({
        groupsInRange: typeof body.groups_in_range === 'number' ? body.groups_in_range : list.length,
        tubesDrawn: drawn,
        axisFallback: typeof body.tubes_axis_fallback === 'number' ? body.tubes_axis_fallback : 0,
      });
      setDemandTubes(list);
    } catch (e) {
      setTubesErr(e instanceof Error ? e.message : 'Error de red');
      setDemandTubes([]);
      setTubesMeta(null);
    } finally {
      setTubesLoading(false);
    }
  }, [accessToken, refetch, tubeFrom, tubeTo, showDemandTubes]);

  useEffect(() => {
    if (!ready || !isAdmin) return;
    void loadTubes();
  }, [ready, isAdmin, loadTubes]);

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && localStorage.getItem('admin:corridors:outlineOnly') === '1') {
        setCorridorOutlineOnly(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    setVisibility((prev) => {
      const next: CorridorLayerVisibility = { ...prev };
      for (const r of rows) {
        if (!next[r.id]) next[r.id] = { origin: true, dest: true };
      }
      for (const id of Object.keys(next)) {
        if (!rows.some((r) => r.id === id)) delete next[id];
      }
      return next;
    });
  }, [rows]);

  const patchZone = useCallback(
    async (corridorId: string, kind: 'origin' | 'destination', payload: CorridorZoneEditPayload) => {
      setSaveMsg(null);
      setSaveErr(null);
      setSaving(true);
      let token = accessToken ?? (await refetch()) ?? '';
      if (!token) {
        setSaveErr('No hay sesión.');
        setSaving(false);
        return;
      }
      const body = kind === 'origin' ? { origin_zone: payload } : { destination_zone: payload };
      try {
        let res = await fetch(`/api/admin/corridors/${corridorId}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });
        if (res.status === 401) {
          token = (await refetch()) ?? '';
          if (token) {
            res = await fetch(`/api/admin/corridors/${corridorId}`, {
              method: 'PATCH',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify(body),
            });
          }
        }
        const data = (await res.json()) as { corridor?: CorridorRow; error?: string };
        if (!res.ok) {
          setSaveErr(typeof data.error === 'string' ? data.error : `Error ${res.status}`);
          return;
        }
        if (data.corridor) {
          setRows((prev) => prev.map((r) => (r.id === data.corridor!.id ? { ...data.corridor! } : r)));
        }
        setSaveMsg('Zona guardada en la base.');
      } catch (e) {
        setSaveErr(e instanceof Error ? e.message : 'Error de red');
      } finally {
        setSaving(false);
      }
    },
    [accessToken, refetch]
  );

  const setLayerVis = useCallback((id: string, key: 'origin' | 'dest', value: boolean) => {
    setVisibility((p) => ({
      ...p,
      [id]: {
        origin: key === 'origin' ? value : (p[id]?.origin ?? true),
        dest: key === 'dest' ? value : (p[id]?.dest ?? true),
      },
    }));
  }, []);

  if (!ready) {
    return <p className="text-gray-500">Cargando…</p>;
  }
  if (!isAdmin) {
    return null;
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Corredores de demanda</h1>
          <p className="text-gray-600 text-sm mt-1 max-w-3xl">
            Acá ves las <strong>zonas geográficas (hexágono)</strong> que el sistema usa para decidir si un pedido entra al flujo
            automático (clasificación → agrupación por corredor y franja de 15 minutos). Los pedidos que no caen en
            ningún corredor <strong>activo</strong> siguen existiendo, pero <strong>no</strong> pasan por ese camino.
          </p>
        </div>
        <Link href="/admin" className="text-sm text-green-600 hover:underline font-medium shrink-0">
          ← Inicio admin
        </Link>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-sm text-amber-950 space-y-2">
        <p className="font-semibold">Qué implica en la práctica</p>
        <ul className="list-disc pl-5 space-y-1 text-amber-900/95">
          <li>
            Cada pedido nuevo se evalúa contra estas zonas: origen dentro de <strong>Zona origen</strong> y destino
            dentro de <strong>Zona destino</strong> del mismo corredor (hexágono si está guardado; si no, bbox legacy).
          </li>
          <li>
            Si hay varios corredores que calzan, gana el de <strong>mayor prioridad</strong> (número más alto en la
            tabla).
          </li>
          <li>
            Solo pedidos con <strong>inicio de ventana horaria</strong> entran a la clasificación automática por
            corredor; el horario se agrupa en bloques de <strong>15 minutos</strong> (Paraguay).
          </li>
          <li>
            Podés <strong>editar los hexágonos en el mapa</strong>; al soltar se guardan en la tabla{' '}
            <code className="bg-amber-100/80 px-1 rounded text-xs">corridors</code>. Los pedidos ya guardados no se
            reclasifican solos: hace falta mantenimiento o nuevos inserts.
          </li>
          <li>
            Usá <strong>Capas</strong> en la tabla para mostrar u ocultar origen/destino cuando se superponen varias
            zonas.
          </li>
          <li>
            Los <strong>tubos violeta</strong> usan el mismo radio (~2 km al eje) que el sync geográfico de grupos. El
            eje sigue la <strong>polilínea de ruta</strong> guardada (el sync suele armarla con OSRM sobre la red vial);
            no es una copia del estilo &quot;calles principales&quot; del mapa base.
          </li>
        </ul>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <button
          type="button"
          onClick={() => void load()}
          className="text-sm font-medium text-green-700 border border-green-600 rounded-lg px-3 py-1.5 hover:bg-green-50 disabled:opacity-50"
          disabled={loading}
        >
          Actualizar
        </button>
        {loading && <span className="text-sm text-gray-500">Cargando…</span>}
        {saving && <span className="text-sm text-teal-700">Guardando zona…</span>}
      </div>

      {err && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>
      )}
      {saveErr && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{saveErr}</div>
      )}
      {saveMsg && !saveErr && (
        <div className="mb-4 text-sm text-gray-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          {saveMsg}
        </div>
      )}

      {!loading && rows.length === 0 && !err && (
        <p className="text-gray-600 text-sm">
          No hay filas en <code className="bg-gray-100 px-1 rounded">corridors</code> o la migración de corredores no
          está aplicada en este entorno.
        </p>
      )}

      {(rows.length > 0 || showDemandTubes) && (
        <div className="mb-8 space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Vista en mapa</h2>
          <p className="text-sm text-gray-600">
            Contorno <span className="font-medium text-sky-800">azul</span> = zona de <strong>origen</strong>;{' '}
            <span className="font-medium text-orange-800">naranja</span> = zona de <strong>destino</strong>. La malla
            fina (~150 m por celda) es referencia visual del tamaño de hexágono acordado. Si las zonas se superponen,
            usá las casillas de capas en la tabla.
          </p>
          <div className="flex flex-wrap items-end gap-4 p-3 bg-violet-50/80 border border-violet-200 rounded-xl">
            <label className="inline-flex items-center gap-2 text-sm text-violet-950 cursor-pointer">
              <input
                type="checkbox"
                checked={showDemandTubes}
                onChange={(e) => setShowDemandTubes(e.target.checked)}
              />
              Ver tubos sync (2 km)
            </label>
            <div>
              <label className="block text-xs font-medium text-violet-900 mb-0.5">Tubos — desde</label>
              <input
                type="date"
                value={tubeFrom}
                onChange={(e) => setTubeFrom(e.target.value)}
                className="border border-violet-300 rounded-lg px-2 py-1 text-sm"
                disabled={!showDemandTubes}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-violet-900 mb-0.5">Tubos — hasta</label>
              <input
                type="date"
                value={tubeTo}
                onChange={(e) => setTubeTo(e.target.value)}
                className="border border-violet-300 rounded-lg px-2 py-1 text-sm"
                disabled={!showDemandTubes}
              />
            </div>
            <button
              type="button"
              onClick={() => void loadTubes()}
              className="text-sm font-medium text-violet-800 border border-violet-500 rounded-lg px-3 py-1 hover:bg-violet-100 disabled:opacity-50"
              disabled={!showDemandTubes || tubesLoading}
            >
              {tubesLoading ? 'Cargando tubos…' : 'Recargar tubos'}
            </button>
            {showDemandTubes && !tubesLoading && tubesMeta !== null && (
              <span className="text-xs text-violet-800">
                Grupos en rango: {tubesMeta.groupsInRange} · Tubos dibujados: {tubesMeta.tubesDrawn}
                {tubesMeta.axisFallback > 0
                  ? ` (${tubesMeta.axisFallback} con eje desde trip_requests)`
                  : ''}
              </span>
            )}
          </div>
          {showDemandTubes && !tubesLoading && tubesMeta && tubesMeta.groupsInRange > 0 && tubesMeta.tubesDrawn === 0 && (
            <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Hay {tubesMeta.groupsInRange} fila(s) en <code className="text-xs bg-amber-100/80 px-1 rounded">demand_route_groups</code> en
              esas fechas, pero ninguna produce un tubo: revisá <code className="text-xs bg-amber-100/80 px-1 rounded">base_polyline</code> o
              corré <strong>POST /api/demand-routes/sync</strong> para regenerar grupos con ruta.
            </div>
          )}
          {tubesErr && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{tubesErr}</div>
          )}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-gray-600 mb-1">
            <label className="inline-flex items-center gap-2 cursor-pointer text-gray-800 font-medium">
              <input
                type="checkbox"
                checked={corridorOutlineOnly}
                onChange={(e) => {
                  const on = e.target.checked;
                  setCorridorOutlineOnly(on);
                  try {
                    localStorage.setItem('admin:corridors:outlineOnly', on ? '1' : '0');
                  } catch {
                    /* ignore */
                  }
                }}
              />
              Solo bordes (sin relleno)
            </label>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-4 h-3 rounded border border-violet-700 bg-violet-400/40" /> Tubo sync
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-4 h-3 rounded border-2 border-sky-800 bg-sky-500/30" /> Zona origen
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-4 h-3 rounded border-2 border-orange-700 bg-orange-500/30" /> Zona destino
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-4 h-3 rounded border border-gray-400 border-dashed bg-gray-200/80" />{' '}
              Corredor inactivo (más tenue)
            </span>
          </div>
          <AdminCorridorsMap
            corridors={rows}
            visibility={visibility}
            onZoneEdited={patchZone}
            demandTubes={demandTubes}
            showDemandTubes={showDemandTubes}
            corridorZonesOutlineOnly={corridorOutlineOnly}
          />
        </div>
      )}

      {(rows.length > 0 || showDemandTubes) && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left">
                <th className="px-4 py-3 font-semibold text-gray-900" colSpan={8}>
                  Detalle en tabla y capas en el mapa
                </th>
              </tr>
              <tr className="bg-gray-50 border-b border-gray-200 text-left">
                <th className="px-4 py-3 font-semibold text-gray-900">Nombre</th>
                <th className="px-4 py-3 font-semibold text-gray-900">Slug</th>
                <th className="px-4 py-3 font-semibold text-gray-900">Activo</th>
                <th className="px-4 py-3 font-semibold text-gray-900">Prioridad</th>
                <th className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap">Capa origen</th>
                <th className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap">Capa destino</th>
                <th className="px-4 py-3 font-semibold text-gray-900">Zona origen (bbox)</th>
                <th className="px-4 py-3 font-semibold text-gray-900">Zona destino (bbox)</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-gray-600 text-center">
                    Sin filas en <code className="bg-gray-100 px-1 rounded text-xs">corridors</code>. Aplicá la
                    migración 058 en Supabase o insertá corredores.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-gray-100 last:border-0 align-top">
                  <td className="px-4 py-3 font-medium text-gray-900">{r.name}</td>
                  <td className="px-4 py-3 text-gray-700 font-mono text-xs">{r.slug}</td>
                  <td className="px-4 py-3">
                    {r.is_active ? (
                      <span className="text-green-700 font-medium">Sí</span>
                    ) : (
                      <span className="text-gray-500">No</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-800">{r.sort_priority}</td>
                  <td className="px-4 py-3">
                    <label className="inline-flex items-center gap-2 cursor-pointer text-gray-700">
                      <input
                        type="checkbox"
                        checked={visibility[r.id]?.origin !== false}
                        onChange={(e) => setLayerVis(r.id, 'origin', e.target.checked)}
                      />
                      <span className="text-xs">Ver</span>
                    </label>
                  </td>
                  <td className="px-4 py-3">
                    <label className="inline-flex items-center gap-2 cursor-pointer text-gray-700">
                      <input
                        type="checkbox"
                        checked={visibility[r.id]?.dest !== false}
                        onChange={(e) => setLayerVis(r.id, 'dest', e.target.checked)}
                      />
                      <span className="text-xs">Ver</span>
                    </label>
                  </td>
                  <td className="px-4 py-3 text-gray-600 max-w-[200px]">
                    <span className="break-words">{zoneSummary(r.origin_zone)}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 max-w-[200px]">
                    <span className="break-words">{zoneSummary(r.destination_zone)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
