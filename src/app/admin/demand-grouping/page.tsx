'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAdminAuth } from '../AdminAuthContext';

type Diagnostics = Record<string, unknown> | null;

export default function AdminDemandGroupingPage() {
  const { accessToken, ready, isAdmin, refetch } = useAdminAuth();
  const [diagnostics, setDiagnostics] = useState<Diagnostics>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagErr, setDiagErr] = useState<string | null>(null);

  const [runLoading, setRunLoading] = useState(false);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<unknown>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [dryRunErr, setDryRunErr] = useState<string | null>(null);
  const [lastDryRun, setLastDryRun] = useState<unknown>(null);
  /** GET diagnostics?explain=1 — muestras geo (motivos) + classified listos para RPC. */
  const [includeExplain, setIncludeExplain] = useState(false);

  const authHeaders = useCallback((): HeadersInit => {
    const h: Record<string, string> = {};
    if (accessToken) h.Authorization = `Bearer ${accessToken}`;
    return h;
  }, [accessToken]);

  const loadDiagnostics = useCallback(async () => {
    if (!accessToken) return;
    setDiagLoading(true);
    setDiagErr(null);
    try {
      const q = includeExplain ? '?explain=1' : '';
      let token = accessToken;
      let res = await fetch(`/api/admin/demand-grouping/diagnostics${q}`, {
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        token = (await refetch()) ?? '';
        if (token) {
          res = await fetch(`/api/admin/demand-grouping/diagnostics${q}`, {
            credentials: 'include',
            headers: { Authorization: `Bearer ${token}` },
          });
        }
      }
      const body = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setDiagErr(typeof body.error === 'string' ? body.error : 'No se pudo cargar el diagnóstico');
        setDiagnostics(null);
        return;
      }
      setDiagnostics(body);
    } catch (e) {
      setDiagErr(e instanceof Error ? e.message : 'Error de red');
      setDiagnostics(null);
    } finally {
      setDiagLoading(false);
    }
  }, [accessToken, refetch, includeExplain]);

  useEffect(() => {
    if (!ready || !isAdmin || !accessToken) return;
    void loadDiagnostics();
  }, [ready, isAdmin, accessToken, loadDiagnostics, includeExplain]);

  const runDryRunGeo = async () => {
    if (!accessToken) return;
    setDryRunErr(null);
    setDryRunLoading(true);
    try {
      let token = accessToken;
      let res = await fetch('/api/admin/demand-grouping/dry-run', {
        method: 'POST',
        credentials: 'include',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.status === 401) {
        token = (await refetch()) ?? '';
        if (token) {
          res = await fetch('/api/admin/demand-grouping/dry-run', {
            method: 'POST',
            credentials: 'include',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
          });
        }
      }
      const body = await res.json();
      if (!res.ok) {
        setDryRunErr(typeof (body as { error?: string }).error === 'string' ? (body as { error: string }).error : 'Falló el dry-run');
        setLastDryRun(body);
        return;
      }
      setLastDryRun(body);
      await loadDiagnostics();
    } catch (e) {
      setDryRunErr(e instanceof Error ? e.message : 'Error de red');
    } finally {
      setDryRunLoading(false);
    }
  };

  const runExecute = async (mode: 'both' | 'classified' | 'geo') => {
    if (!accessToken) return;
    setRunErr(null);
    setRunLoading(true);
    try {
      let token = accessToken;
      let res = await fetch('/api/admin/demand-grouping/execute', {
        method: 'POST',
        credentials: 'include',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      if (res.status === 401) {
        token = (await refetch()) ?? '';
        if (token) {
          res = await fetch('/api/admin/demand-grouping/execute', {
            method: 'POST',
            credentials: 'include',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ mode }),
          });
        }
      }
      const body = await res.json();
      if (!res.ok) {
        setRunErr(typeof (body as { error?: string }).error === 'string' ? (body as { error: string }).error : 'Falló la ejecución');
        setLastRun(body);
        return;
      }
      setLastRun(body);
      await loadDiagnostics();
    } catch (e) {
      setRunErr(e instanceof Error ? e.message : 'Error de red');
    } finally {
      setRunLoading(false);
    }
  };

  if (!ready || !isAdmin) {
    return (
      <div className="text-gray-500 text-sm py-8">Comprobando permisos…</div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Agrupación de demanda</h1>
        <p className="text-sm text-gray-600 mt-1 max-w-3xl">
          Fase 1–2: diagnóstico en vivo y ejecución <strong>en proceso</strong> (service role tras validar admin): mismo RPC y mismo
          sync geo que antes, sin depender de un HTTP interno al deploy. Ves conteos antes/después y el resultado de cada paso.
        </p>
      </div>

      <details className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-800">
        <summary className="font-semibold cursor-pointer text-slate-900">Auditoría rápida (Fase 0) — qué hay hoy en el código</summary>
        <ul className="mt-3 list-disc pl-5 space-y-2">
          <li>
            Activá <strong>Incluir muestras</strong> y refrescá: en el JSON verás <code className="text-xs bg-white px-1 rounded">explain_samples</code>{' '}
            con intentos de encaje geo (motivos como <code className="text-xs bg-white px-1 rounded">outside_2km_corridor</code>) y filas
            classified listas para el RPC.
          </li>
          <li>
            <strong>Dry-run geo:</strong> simula el sync sin INSERT/UPDATE en Supabase; igual puede llamar a <strong>OSRM</strong> para
            calcular polilíneas que faltan (solo no las guarda). El RPC classified no tiene simulación en servidor sin tocar Postgres.
          </li>
          <li>
            <strong>Dos pipelines:</strong> geo (<code className="text-xs bg-white px-1 rounded">/api/demand-routes/sync</code>) para
            pedidos <code className="text-xs bg-white px-1 rounded">pending</code> sin clasificar o <code className="text-xs bg-white px-1 rounded">unclassified</code>; y corredor+bucket (
            <code className="text-xs bg-white px-1 rounded">/api/demand-routes/auto-group-classified</code>) para <code className="text-xs bg-white px-1 rounded">classified</code> con{' '}
            <code className="text-xs bg-white px-1 rounded">corridor_id</code> y <code className="text-xs bg-white px-1 rounded">time_bucket</code>.
          </li>
          <li>
            <strong>Tubos violeta</strong> en Corredores leen <code className="text-xs bg-white px-1 rounded">demand_route_groups</code> con
            polilínea dibujable. Sin grupos → sin tubo (esperable).
          </li>
          <li>
            <strong>Mapa despacho</strong> puede mostrar <code className="text-xs bg-white px-1 rounded">trip_requests</code> y atajos aunque
            no haya grupos: son capas distintas.
          </li>
        </ul>
      </details>

      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-lg font-semibold text-gray-900">Diagnóstico (lectura)</h2>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={includeExplain}
                onChange={(e) => setIncludeExplain(e.target.checked)}
              />
              Incluir muestras (motivos geo + classified listos)
            </label>
            <button
              type="button"
              className="text-sm py-2 px-3 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
              disabled={diagLoading || !accessToken}
              onClick={() => void loadDiagnostics()}
            >
              {diagLoading ? 'Actualizando…' : 'Refrescar'}
            </button>
          </div>
        </div>
        {diagErr && <p className="text-sm text-red-700 mb-2">{diagErr}</p>}
        {diagnostics ? (
          <pre className="text-xs bg-gray-900 text-green-100 p-3 rounded-lg overflow-x-auto max-h-[420px] overflow-y-auto">
            {JSON.stringify(diagnostics, null, 2)}
          </pre>
        ) : (
          !diagLoading && <p className="text-sm text-gray-500">Sin datos todavía.</p>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Ejecutar agrupación (real)</h2>
        <p className="text-xs text-gray-600 mb-3">
          Usa tu sesión admin hacia los endpoints existentes. Orden en modo “ambos”: primero{' '}
          <strong>auto-group-classified</strong>, luego <strong>sync geo</strong>.
        </p>
        {runErr && <p className="text-sm text-red-700 mb-2">{runErr}</p>}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="text-sm py-2 px-4 rounded-lg border border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100 disabled:opacity-50"
            disabled={dryRunLoading || !accessToken}
            onClick={() => void runDryRunGeo()}
          >
            {dryRunLoading ? 'Simulando…' : 'Simular geo (dry-run)'}
          </button>
          <button
            type="button"
            className="btn-primary text-sm py-2 px-4 disabled:opacity-50"
            disabled={runLoading || !accessToken}
            onClick={() => void runExecute('both')}
          >
            {runLoading ? 'Ejecutando…' : 'Ambos pasos'}
          </button>
          <button
            type="button"
            className="text-sm py-2 px-4 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
            disabled={runLoading || !accessToken}
            onClick={() => void runExecute('classified')}
          >
            Solo corredor + bucket
          </button>
          <button
            type="button"
            className="text-sm py-2 px-4 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
            disabled={runLoading || !accessToken}
            onClick={() => void runExecute('geo')}
          >
            Solo sync geo
          </button>
        </div>
        {dryRunErr && <p className="text-sm text-red-700 mb-2">{dryRunErr}</p>}
        {lastDryRun != null && (
          <div className="mt-4">
            <h3 className="text-sm font-medium text-amber-900 mb-1">Última simulación geo (sin escribir en base)</h3>
            <pre className="text-xs bg-amber-950 text-amber-50 p-3 rounded-lg overflow-x-auto max-h-[320px] overflow-y-auto">
              {JSON.stringify(lastDryRun, null, 2)}
            </pre>
          </div>
        )}
        {lastRun != null && (
          <div className="mt-4">
            <h3 className="text-sm font-medium text-gray-800 mb-1">Última ejecución real</h3>
            <pre className="text-xs bg-gray-900 text-amber-100 p-3 rounded-lg overflow-x-auto max-h-[360px] overflow-y-auto">
              {JSON.stringify(lastRun, null, 2)}
            </pre>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-500">
        Siguiente mejora opcional: RPC classified con función Postgres de simulación, o exportar CSV del <code className="bg-gray-100 px-1 rounded">planned</code> del dry-run geo.
      </p>
    </div>
  );
}
