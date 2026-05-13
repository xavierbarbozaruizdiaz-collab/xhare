'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAdminAuth } from '../AdminAuthContext';

type Diagnostics = Record<string, unknown> | null;

export default function AdminDemandGroupingPage() {
  const { accessToken, ready, isAdmin, refetch } = useAdminAuth();
  const [diagnostics, setDiagnostics] = useState<Diagnostics>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagErr, setDiagErr] = useState<string | null>(null);
  const [executeLoading, setExecuteLoading] = useState(false);
  const [executeErr, setExecuteErr] = useState<string | null>(null);
  const [executeResult, setExecuteResult] = useState<Record<string, unknown> | null>(null);

  /** GET diagnostics?explain=1 — muestras geo (motivos) + classified listos para RPC. */
  const [includeExplain, setIncludeExplain] = useState(false);

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

  const runExecute = useCallback(async () => {
    if (!accessToken) return;
    setExecuteLoading(true);
    setExecuteErr(null);
    setExecuteResult(null);
    try {
      let token = accessToken;
      let res = await fetch('/api/admin/demand-grouping/execute', {
        method: 'POST',
        credentials: 'include',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
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
            body: '{}',
          });
        }
      }
      const body = (await res.json()) as Record<string, unknown>;
      setExecuteResult(body);
      if (!res.ok) {
        setExecuteErr(typeof body.error === 'string' ? body.error : `Error HTTP ${res.status}`);
      }
      await loadDiagnostics();
    } catch (e) {
      setExecuteErr(e instanceof Error ? e.message : 'Error de red');
    } finally {
      setExecuteLoading(false);
    }
  }, [accessToken, refetch, loadDiagnostics]);

  if (!ready || !isAdmin) {
    return (
      <div className="text-gray-500 text-sm py-8">Comprobando permisos…</div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Agrupación de demanda (HEX-only)</h1>
        <p className="text-sm text-gray-600 mt-1 max-w-3xl">
          Runtime simplificado: solo el motor <strong>HEX</strong>. Los motores corridor/classified y geo_sync quedaron
          deshabilitados. Podés disparar una corrida desde este panel (botón abajo) o por{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">GET /api/cron/demand-grouping</code> con{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">Authorization: Bearer CRON_SECRET</code> (o{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">DEMAND_ROUTES_SYNC_SECRET</code>). En Vercel{' '}
          <strong>Hobby</strong> no se puede declarar un cron cada 5 min en <code className="text-xs bg-gray-100 px-1 rounded">vercel.json</code>{' '}
          (bloquea el deploy); usá plan <strong>Pro</strong> para crons frecuentes en Vercel o el workflow de GitHub{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">.github/workflows/demand-grouping-cron.yml</code> con secrets del repo.
        </p>
      </div>

      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Ejecutar agrupamiento ahora</h2>
        <p className="text-sm text-gray-700 mb-3 max-w-3xl">
          Corre el mismo pipeline que el cron (registro en <code className="text-xs bg-white px-1 rounded">demand_grouping_runs</code> con{' '}
          <code className="text-xs bg-white px-1 rounded">trigger_source: manual</code>). Límite: hasta 4 veces cada 2 minutos por sesión
          admin.
        </p>
        <button
          type="button"
          className="text-sm py-2.5 px-4 rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={executeLoading || !accessToken}
          onClick={() => void runExecute()}
        >
          {executeLoading ? 'Ejecutando…' : 'Ejecutar agrupamiento HEX'}
        </button>
        {executeErr && <p className="text-sm text-red-700 mt-2">{executeErr}</p>}
        {executeResult && (
          <pre className="text-xs bg-gray-900 text-amber-100 p-3 rounded-lg overflow-x-auto max-h-[280px] overflow-y-auto mt-3">
            {JSON.stringify(executeResult, null, 2)}
          </pre>
        )}
      </div>

      <details className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-800">
        <summary className="font-semibold cursor-pointer text-slate-900">Auditoría rápida — estado actual</summary>
        <ul className="mt-3 list-disc pl-5 space-y-2">
          <li>
            El pipeline productivo corre en <strong>HEX-only</strong> para evitar que varios motores procesen la misma demanda.
          </li>
          <li>
            La clasificación por etiquetas HEX se calcula al crear la trip (<code className="text-xs bg-white px-1 rounded">origin_super_hex</code>{' '}
            y <code className="text-xs bg-white px-1 rounded">dest_super_hex</code>).
          </li>
          <li>
            Endpoints legacy de corridor/classified y geo_sync permanecen como <strong>noop/deprecated</strong> por compatibilidad.
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
              Incluir detalle adicional
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

      <p className="text-xs text-gray-500">
        El diagnóstico es lectura; la ejecución puede ser manual (botón), cron o GitHub Actions.
      </p>
    </div>
  );
}
