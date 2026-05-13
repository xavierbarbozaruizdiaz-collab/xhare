'use client';

import { useCallback, useEffect, useState } from 'react';

export type TrackPayload = {
  ok: true;
  share_code: string;
  status: string;
  departure_time: string | null;
  origin_label: string | null;
  destination_label: string | null;
  route_name: string | null;
  vehicle_info: string | null;
  driver_first_name: string | null;
  base_route_polyline: Array<{ lat: number; lng: number }>;
  driver_lat: number | null;
  driver_lng: number | null;
  driver_location_updated_at: string | null;
};

function statusLabel(st: string): string {
  switch (st) {
    case 'published':
      return 'Publicado';
    case 'booked':
      return 'Reservado';
    case 'en_route':
      return 'En camino';
    case 'awaiting_driver':
      return 'Buscando conductor';
    case 'completed':
      return 'Finalizado';
    case 'cancelled':
      return 'Cancelado';
    default:
      return st || '—';
  }
}

function formatDep(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('es-PY', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function SafetyShareTrackClient({ code }: { code: string }) {
  const [data, setData] = useState<TrackPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/rides/track/${encodeURIComponent(code)}`, { cache: 'no-store' });
      const j = (await res.json()) as TrackPayload & { error?: string };
      if (!res.ok) {
        setErr(j.error ?? 'No se pudo cargar');
        setData(null);
        return;
      }
      if (!j.ok) {
        setErr('Respuesta inválida');
        setData(null);
        return;
      }
      setErr(null);
      setData(j);
    } catch {
      setErr('Error de red');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 18_000);
    return () => clearInterval(t);
  }, [load]);

  if (loading && !data) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-gray-600">
        Cargando seguimiento…
      </div>
    );
  }

  if (err || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">
        <p className="font-medium">No disponible</p>
        <p className="text-sm mt-1">{err ?? 'Este enlace no es válido o el viaje ya no está activo.'}</p>
      </div>
    );
  }

  const mapsHref =
    data.driver_lat != null &&
    data.driver_lng != null &&
    Number.isFinite(data.driver_lat) &&
    Number.isFinite(data.driver_lng)
      ? `https://www.google.com/maps?q=${data.driver_lat},${data.driver_lng}`
      : null;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Seguimiento de viaje</p>
        <p className="text-lg font-semibold text-gray-900 mt-1">Xhare · código {data.share_code}</p>
        <p className="text-sm text-gray-600 mt-2">
          Vista solo de lectura para contactos de confianza. No muestra datos personales de pasajeros.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-800">
            {statusLabel(data.status)}
          </span>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase">Salida</p>
          <p className="text-gray-900">{formatDep(data.departure_time)}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase">Ruta</p>
          <p className="text-gray-900">
            {data.route_name?.trim() ||
              `${data.origin_label ?? 'Origen'} → ${data.destination_label ?? 'Destino'}`}
          </p>
        </div>
        {data.driver_first_name ? (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase">Conductor</p>
            <p className="text-gray-900">{data.driver_first_name}</p>
          </div>
        ) : null}
        {data.vehicle_info?.trim() ? (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase">Vehículo</p>
            <p className="text-gray-900">{data.vehicle_info.trim()}</p>
          </div>
        ) : null}
      </div>

      {data.status === 'en_route' && mapsHref ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50/90 p-5">
          <p className="text-sm font-medium text-blue-950">Ubicación del conductor (actualización periódica)</p>
          {data.driver_location_updated_at ? (
            <p className="text-xs text-blue-800/90 mt-1">
              Último dato:{' '}
              {new Date(data.driver_location_updated_at).toLocaleString('es-PY', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </p>
          ) : null}
          <a
            href={mapsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Abrir en Google Maps
          </a>
        </div>
      ) : data.status === 'en_route' ? (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-4">
          El viaje está en curso; la posición del conductor aún no está disponible en este momento.
        </p>
      ) : null}

      <p className="text-xs text-gray-500 text-center">
        Esta página se actualiza sola cada pocos segundos mientras la tenés abierta.
      </p>
    </div>
  );
}
