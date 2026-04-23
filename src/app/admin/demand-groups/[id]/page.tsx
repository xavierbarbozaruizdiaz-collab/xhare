'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useAdminAuth } from '../../AdminAuthContext';

type Detail = {
  id: string;
  requested_date?: string | null;
  requested_time?: string | null;
  origin_city?: string | null;
  destination_city?: string | null;
  passenger_count?: number;
  ride_id?: string | null;
  base_polyline?: Array<{ lat: number; lng: number }> | null;
  route_polyline?: Array<{ lat: number; lng: number }> | null;
  passengers?: Array<{
    trip_request_id: string;
    user_id?: string;
    seats?: number;
    origin_label?: string | null;
    destination_label?: string | null;
  }>;
  legs?: Array<{
    visit_order: number;
    stop_type: string;
    passenger_name?: string;
    label?: string;
    action?: string;
    fare_amount?: number | null;
    lat?: number | null;
    lng?: number | null;
  }>;
  financial_summary?: {
    total_passengers?: number;
    total_to_collect_gs?: number;
    driver_net_earnings_gs?: number;
    driver_fee_percent?: number;
    grouped_seats_taken?: number;
    currency?: string;
  };
};

export default function AdminDemandGroupDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params?.id === 'string' ? params.id : '';
  const { accessToken, ready, isAdmin, refetch } = useAdminAuth();

  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dissolveErr, setDissolveErr] = useState<string | null>(null);
  const [dissolving, setDissolving] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!accessToken || !id) return;
    setLoading(true);
    setLoadErr(null);
    try {
      let token = accessToken;
      let res = await fetch(`/api/admin/demand-groups/${encodeURIComponent(id)}`, {
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        token = (await refetch()) ?? '';
        if (token) {
          res = await fetch(`/api/admin/demand-groups/${encodeURIComponent(id)}`, {
            credentials: 'include',
            headers: { Authorization: `Bearer ${token}` },
          });
        }
      }
      const body = (await res.json()) as Detail & { error?: string };
      if (!res.ok) {
        setLoadErr(typeof body.error === 'string' ? body.error : 'No se pudo cargar el detalle');
        setDetail(null);
        return;
      }
      setDetail(body);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : 'Error de red');
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [accessToken, id, refetch]);

  useEffect(() => {
    if (!ready || !isAdmin || !accessToken || !id) return;
    void loadDetail();
  }, [ready, isAdmin, accessToken, id, loadDetail]);

  const dissolve = async () => {
    if (!accessToken || !id) return;
    if (
      !window.confirm(
        '¿Disolver este agrupamiento?\n\n' +
          'Se cancelará el ride de sistema (si está en awaiting_driver/draft), los pedidos volverán a pendientes y se borrará el grupo. ' +
          'No se puede si el viaje está publicado o en curso.'
      )
    ) {
      return;
    }
    setDissolving(true);
    setDissolveErr(null);
    try {
      let token = accessToken;
      let res = await fetch(`/api/admin/demand-groups/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        token = (await refetch()) ?? '';
        if (token) {
          res = await fetch(`/api/admin/demand-groups/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            credentials: 'include',
            headers: { Authorization: `Bearer ${token}` },
          });
        }
      }
      const body = (await res.json()) as { error?: string; ok?: boolean };
      if (!res.ok) {
        setDissolveErr(typeof body.error === 'string' ? body.error : 'No se pudo disolver');
        return;
      }
      router.push('/admin/demand-groups');
      router.refresh();
    } catch (e) {
      setDissolveErr(e instanceof Error ? e.message : 'Error de red');
    } finally {
      setDissolving(false);
    }
  };

  if (!ready || !isAdmin) {
    return <div className="text-gray-500 text-sm py-8">Comprobando permisos…</div>;
  }

  const poly = detail?.route_polyline ?? detail?.base_polyline ?? [];
  const fs = detail?.financial_summary;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/demand-groups" className="text-sm text-green-600 hover:underline font-medium">
          ← Volver al listado
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Grupo de demanda</h1>
        <p className="text-sm text-gray-500 font-mono mt-1 break-all">{id}</p>
      </div>

      {loading && <p className="text-sm text-gray-600">Cargando…</p>}
      {loadErr && <p className="text-sm text-red-700">{loadErr}</p>}

      {detail && !loading && (
        <>
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-2">
            <h2 className="text-lg font-semibold text-gray-900">Resumen</h2>
            <p className="text-sm text-gray-800">
              <strong>{detail.origin_city ?? '—'}</strong> → <strong>{detail.destination_city ?? '—'}</strong>
            </p>
            <p className="text-sm text-gray-600">
              Fecha: {detail.requested_date ?? '—'} · Hora: {detail.requested_time ?? '—'} · Pasajeros (detalle):{' '}
              {detail.passenger_count ?? detail.passengers?.length ?? '—'}
            </p>
            <p className="text-sm text-gray-600">
              Ride sistema:{' '}
              {detail.ride_id ? <span className="font-mono text-xs">{detail.ride_id}</span> : '— (sin ride materializado)'}
            </p>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-2">
            <h2 className="text-lg font-semibold text-gray-900">Montos (estimado conductor)</h2>
            {fs ? (
              <ul className="text-sm text-gray-800 space-y-1">
                <li>Total a recaudar: {(fs.total_to_collect_gs ?? 0).toLocaleString('es-PY')} {fs.currency ?? 'PYG'}</li>
                <li>Ganancia neta conductor: {(fs.driver_net_earnings_gs ?? 0).toLocaleString('es-PY')} </li>
                <li>Comisión: {fs.driver_fee_percent ?? '—'}%</li>
                {fs.grouped_seats_taken != null ? <li>Asientos ocupados (grupo): {fs.grouped_seats_taken}</li> : null}
              </ul>
            ) : (
              <p className="text-sm text-gray-500">Sin resumen financiero.</p>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-2">
            <h2 className="text-lg font-semibold text-gray-900">Paradas / orden</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-gray-600 border-b border-gray-200">
                  <tr>
                    <th className="px-2 py-1.5">#</th>
                    <th className="px-2 py-1.5">Tipo</th>
                    <th className="px-2 py-1.5">Acción</th>
                    <th className="px-2 py-1.5">Monto subida</th>
                    <th className="px-2 py-1.5">Maps</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.legs ?? []).map((l, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="px-2 py-1.5">{l.visit_order}</td>
                      <td className="px-2 py-1.5">{l.stop_type}</td>
                      <td className="px-2 py-1.5">{l.action ?? l.label ?? '—'}</td>
                      <td className="px-2 py-1.5">
                        {l.fare_amount != null ? `${l.fare_amount.toLocaleString('es-PY')} Gs` : '—'}
                      </td>
                      <td className="px-2 py-1.5">
                        {l.lat != null && l.lng != null ? (
                          <a
                            href={`https://www.google.com/maps?q=${l.lat},${l.lng}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-green-600 hover:underline"
                          >
                            Abrir
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-2">
            <h2 className="text-lg font-semibold text-gray-900">Pasajeros</h2>
            <ul className="text-sm text-gray-800 space-y-1 list-disc pl-5">
              {(detail.passengers ?? []).map((p) => (
                <li key={p.trip_request_id}>
                  <span className="font-mono text-xs">{p.trip_request_id.slice(0, 8)}…</span>
                  {p.seats != null ? ` · ${p.seats} asiento(s)` : ''}
                  {p.origin_label ? ` · ${p.origin_label}` : ''}
                  {p.destination_label ? ` → ${p.destination_label}` : ''}
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-2">
            <h2 className="text-lg font-semibold text-gray-900">Ruta (polilínea)</h2>
            <p className="text-xs text-gray-600">
              Puntos: {poly.length}. Vista previa en mapa: abrí el primer y último punto en Google Maps o usá el mapa de
              despacho.
            </p>
            {poly.length >= 2 ? (
              <a
                href={`https://www.google.com/maps/dir/${poly[0]!.lat},${poly[0]!.lng}/${poly[poly.length - 1]!.lat},${poly[poly.length - 1]!.lng}`}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-green-600 hover:underline inline-block"
              >
                Abrir origen → destino en Google Maps
              </a>
            ) : null}
          </div>

          <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 space-y-3">
            <h2 className="text-lg font-semibold text-amber-950">Disolver agrupamiento</h2>
            <p className="text-sm text-amber-950/90">
              Cancela el ride de sistema si aplica, devuelve los pedidos del grupo a <strong>pending</strong> y elimina el
              grupo y sus miembros. No se ejecuta si el viaje del grupo está <strong>publicado, reservado o en ruta</strong>.
            </p>
            {dissolveErr && <p className="text-sm text-red-700">{dissolveErr}</p>}
            <button
              type="button"
              className="text-sm py-2 px-4 rounded-lg bg-red-700 text-white hover:bg-red-800 disabled:opacity-50"
              disabled={dissolving || !accessToken}
              onClick={() => void dissolve()}
            >
              {dissolving ? 'Procesando…' : 'Disolver agrupamiento'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
