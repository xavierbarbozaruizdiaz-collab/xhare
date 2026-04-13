'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useAdminAuth } from '../AdminAuthContext';

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
            Acá ves las <strong>cajas geográficas</strong> que el sistema usa para decidir si un pedido entra al flujo
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
            Cada pedido nuevo se evalúa contra estos rectángulos: origen dentro de <strong>Zona origen</strong> y
            destino dentro de <strong>Zona destino</strong> del mismo corredor.
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
            Cambiar zonas o desactivar un corredor cambia <strong>de inmediato</strong> qué pedidos futuros se
            clasifican; los ya guardados no se recalculan solos salvo procesos de mantenimiento en base de datos.
          </li>
          <li>
            Los corredores viven en la tabla <code className="bg-amber-100/80 px-1 rounded text-xs">corridors</code>;
            para editarlos hoy se usa SQL o migraciones (esta pantalla es lectura para transparencia operativa).
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
      </div>

      {err && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>
      )}

      {!loading && rows.length === 0 && !err && (
        <p className="text-gray-600 text-sm">
          No hay filas en <code className="bg-gray-100 px-1 rounded">corridors</code> o la migración de corredores no
          está aplicada en este entorno.
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left">
                <th className="px-4 py-3 font-semibold text-gray-900">Nombre</th>
                <th className="px-4 py-3 font-semibold text-gray-900">Slug</th>
                <th className="px-4 py-3 font-semibold text-gray-900">Activo</th>
                <th className="px-4 py-3 font-semibold text-gray-900">Prioridad</th>
                <th className="px-4 py-3 font-semibold text-gray-900">Zona origen (bbox)</th>
                <th className="px-4 py-3 font-semibold text-gray-900">Zona destino (bbox)</th>
              </tr>
            </thead>
            <tbody>
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
                  <td className="px-4 py-3 text-gray-600 max-w-[220px]">
                    <span className="break-words">{zoneSummary(r.origin_zone)}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 max-w-[220px]">
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
