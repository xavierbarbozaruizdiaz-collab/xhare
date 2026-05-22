'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const SafetyShareLiveMap = dynamic(() => import('@/components/SafetyShareLiveMap'), { ssr: false });

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
  const searchParams = useSearchParams();
  const bookingId = searchParams.get('b')?.trim() ?? '';
  const [data, setData] = useState<TrackPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const qs = bookingId ? `?b=${encodeURIComponent(bookingId)}` : '';
      const res = await fetch(`/api/rides/track/${encodeURIComponent(code)}${qs}`, { cache: 'no-store' });
      const j = (await res.json()) as TrackPayload & { error?: string; ended?: boolean };
      if (!res.ok) {
        setEnded(Boolean(j.ended));
        setErr(j.error ?? 'No se pudo cargar');
        setData(null);
        return;
      }
      if (!j.ok) {
        setErr('Respuesta inválida');
        setData(null);
        setEnded(false);
        return;
      }
      setErr(null);
      setEnded(false);
      setData(j);
    } catch {
      setErr('Error de red');
      setData(null);
      setEnded(false);
    } finally {
      setLoading(false);
    }
  }, [code, bookingId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 18_000);
    return () => clearInterval(t);
  }, [load]);

  if (loading && !data && !ended) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-gray-600">
        Cargando seguimiento…
      </div>
    );
  }

  if ((err || !data) && ended) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-950">
          <p className="font-semibold">Seguimiento finalizado</p>
          <p className="text-sm mt-2">{err ?? 'Este enlace ya no muestra ubicación en vivo.'}</p>
        </div>
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

  const showLiveMap =
    data.status === 'en_route' &&
    (data.base_route_polyline.length >= 2 ||
      (data.driver_lat != null &&
        data.driver_lng != null &&
        Number.isFinite(data.driver_lat) &&
        Number.isFinite(data.driver_lng)));

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Seguimiento de viaje</p>
        <p className="text-lg font-semibold text-gray-900 mt-1">Xhare · código {data.share_code}</p>
        <p className="text-sm text-gray-600 mt-2">
          Vista solo de lectura para contactos de confianza. No muestra datos personales de pasajeros.
        </p>
      </div>

      {showLiveMap ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm space-y-2">
          <p className="text-sm font-semibold text-slate-800 px-1">Mapa en vivo</p>
          <SafetyShareLiveMap
            polyline={data.base_route_polyline}
            driverLat={data.driver_lat}
            driverLng={data.driver_lng}
          />
          {data.driver_location_updated_at ? (
            <p className="text-xs text-slate-500 px-1">
              Última ubicación del conductor:{' '}
              {new Date(data.driver_location_updated_at).toLocaleString('es-PY', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </p>
          ) : (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg p-2 mx-1">
              Esperando la primera ubicación del conductor…
            </p>
          )}
          {mapsHref ? (
            <a
              href={mapsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 mx-1"
            >
              Abrir en Google Maps
            </a>
          ) : null}
        </div>
      ) : data.status === 'en_route' ? (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-4">
          El viaje está en curso; la posición del conductor aún no está disponible en este momento.
        </p>
      ) : null}

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

      <p className="text-xs text-gray-500 text-center">
        El mapa y la ubicación se actualizan solos cada pocos segundos mientras la página está abierta.
      </p>
    </div>
  );
}
