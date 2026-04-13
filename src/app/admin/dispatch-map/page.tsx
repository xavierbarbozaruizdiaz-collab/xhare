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
  /** Ventana horaria (timestamptz) si existe en la base. */
  requested_time_start?: string | null;
  requested_time_end?: string | null;
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

type RouteStop = {
  key: string;
  lat: number;
  lng: number;
  /** Texto largo para popup / depuración. */
  label: string;
  placeName?: string;
  clientTimeHm?: string | null;
};

function requestedTimeToHm(t: string | null | undefined): string | null {
  const m = String(t ?? '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function hmInAsuncionFromIso(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Asuncion',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '', 10);
  const min = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '', 10);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** `requested_time` HH:mm o fin de ventana en ISO (timestamptz). */
function tripClientHm(t: string | null | undefined): string | null {
  const s = String(t ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return hmInAsuncionFromIso(s);
  return requestedTimeToHm(s);
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function hmToMinutes(hm: string): number | null {
  const m = hm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 60 + min;
}

function minutesToHm(mins: number): string {
  const w = ((Math.round(mins) % (24 * 60)) + (24 * 60)) % (24 * 60);
  return `${String(Math.floor(w / 60)).padStart(2, '0')}:${String(w % 60).padStart(2, '0')}`;
}

/** Reparte la duración total del trazado entre tramos proporcional a distancia recta entre paradas; ancla en la primera parada con `clientTimeHm`. */
function cumulativeEtaHmForStops(
  stops: Array<{ lat: number; lng: number; clientTimeHm?: string | null }>,
  routeDurationMinutes: number | null
): string[] {
  const n = stops.length;
  const dash = () => Array.from({ length: n }, () => '—');
  if (routeDurationMinutes == null || routeDurationMinutes <= 0 || n === 0) return dash();

  const legKm: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    legKm.push(haversineKm(stops[i]!, stops[i + 1]!));
  }
  const totalKm = legKm.reduce((a, b) => a + b, 0);
  if (totalKm <= 0) return dash();

  const legMin = legKm.map((km) => (km / totalKm) * routeDurationMinutes);
  const cum: number[] = [0];
  for (let i = 1; i < n; i++) {
    cum.push(cum[i - 1]! + legMin[i - 1]!);
  }

  let anchor = 0;
  while (anchor < n && !stops[anchor]?.clientTimeHm?.trim()) anchor++;
  if (anchor >= n) return dash();
  const anchorM = hmToMinutes(stops[anchor]!.clientTimeHm!.trim());
  if (anchorM == null) return dash();

  return stops.map((_, i) => {
    const delta = cum[i]! - cum[anchor]!;
    return minutesToHm(anchorM + delta);
  });
}

/** Marcadores del mapa van en pares `…-o` / `…-d` (pedido, ride sistema, atajo). */
function dispatchMarkerPartnerId(id: string): string | null {
  if (id.endsWith('-o')) return `${id.slice(0, -1)}d`;
  if (id.endsWith('-d')) return `${id.slice(0, -1)}o`;
  return null;
}

function routeStopFromDispatchMarker(m: DispatchMapMarker, keySuffix: string): RouteStop {
  return {
    key: `${m.id}-${keySuffix}`,
    lat: m.lat,
    lng: m.lng,
    label: `${m.title}: ${m.subtitle.slice(0, 80)}`,
    placeName: m.placeName?.trim() || undefined,
    clientTimeHm: m.clientTimeHm ?? null,
  };
}

type PassengerShortcutRow = {
  user_id: string;
  slot: string;
  origin_lat: number;
  origin_lng: number;
  destination_lat: number;
  destination_lng: number;
  origin_label: string | null;
  destination_label: string | null;
  scheduled_date: string;
  scheduled_time: string;
  schedule_daily: boolean;
  updated_at: string;
};

function shortcutSlotLabel(slot: string): string {
  if (slot === 'home_to_work') return 'Casa → Trabajo';
  if (slot === 'work_to_home') return 'Trabajo → Casa';
  return slot;
}

/** Origen = naranja, destino = rojo (pedidos, rides sistema y atajos app: mismo criterio). */
const COL = {
  origin: '#f97316',
  destination: '#dc2626',
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

function fmtTimeInAsuncion(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-PY', {
    timeZone: 'America/Asuncion',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Minutos desde medianoche para la hora que cargó el cliente (requested_time). */
function pickupTimeToMinutes(t: string | null | undefined): number | null {
  const m = String(t ?? '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 60 + min;
}

/** Hora de salida del viaje sistema en America/Asuncion. */
function rideDepartureMinutesAsuncion(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Asuncion',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '', 10);
  const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '', 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function parseFilterTimeHHMM(s: string): number | null {
  const v = s?.trim();
  if (!v) return null;
  const m = v.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function passesTimeWindowMinutes(
  minutes: number | null,
  fromStr: string,
  toStr: string
): boolean {
  const fromM = parseFilterTimeHHMM(fromStr);
  const toM = parseFilterTimeHHMM(toStr);
  if (fromM == null && toM == null) return true;
  if (minutes == null) return true;
  if (fromM != null && toM != null) {
    if (fromM <= toM) return minutes >= fromM && minutes <= toM;
    return minutes >= fromM || minutes <= toM;
  }
  if (fromM != null) return minutes >= fromM;
  return minutes <= toM!;
}

function tripTimeSubtitle(tr: TripRow): string {
  const base = fmtWhen(tr.requested_date, tr.requested_time);
  const end = fmtTimeInAsuncion(tr.requested_time_end ?? null);
  if (end) {
    return `${base} · llegada / fin ventana ${end}`;
  }
  return base;
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
  const [showPassengerShortcuts, setShowPassengerShortcuts] = useState(true);
  /** Filtro por la hora que cargó el cliente (requested_time), HH:mm. */
  const [timeFilterFrom, setTimeFilterFrom] = useState('');
  const [timeFilterTo, setTimeFilterTo] = useState('');
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [rides, setRides] = useState<SystemRideRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [passengerShortcuts, setPassengerShortcuts] = useState<PassengerShortcutRow[]>([]);
  const [passengerShortcutsLoadError, setPassengerShortcutsLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [routeStops, setRouteStops] = useState<RouteStop[]>([]);
  const [actingGroup, setActingGroup] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [routePolyline, setRoutePolyline] = useState<Array<{ lat: number; lng: number }>>([]);
  /** Duración total del trazado verde (Google), en minutos; para ETA por parada en la lista. */
  const [routeDurationMinutes, setRouteDurationMinutes] = useState<number | null>(null);
  const [routeLineLoading, setRouteLineLoading] = useState(false);
  const [routeLineHint, setRouteLineHint] = useState<string | null>(null);

  const routeStopEtas = useMemo(
    () => cumulativeEtaHmForStops(routeStops, routeDurationMinutes),
    [routeStops, routeDurationMinutes]
  );

  const load = useCallback(
    async (tokenOverride?: string | null) => {
      const initial = tokenOverride ?? accessToken;
      if (!initial) return;
      setLoading(true);
      setErr(null);
      setPassengerShortcutsLoadError(null);
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
        setPassengerShortcuts([]);
        setPassengerShortcutsLoadError(null);
        return;
      }
      setTrips((body.tripRequests as TripRow[]) ?? []);
      setRides((body.systemRides as SystemRideRow[]) ?? []);
      setGroups((body.demandGroups as GroupRow[]) ?? []);
      setPassengerShortcuts((body.passengerHomeShortcuts as PassengerShortcutRow[]) ?? []);
      setPassengerShortcutsLoadError(
        typeof body.passengerHomeShortcutsError === 'string' ? body.passengerHomeShortcutsError : null
      );
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

  const tripsFiltered = useMemo(() => {
    return trips.filter((tr) => {
      const mins = pickupTimeToMinutes(tr.requested_time);
      return passesTimeWindowMinutes(mins, timeFilterFrom, timeFilterTo);
    });
  }, [trips, timeFilterFrom, timeFilterTo]);

  const ridesFiltered = useMemo(() => {
    return rides.filter((r) => {
      const mins = rideDepartureMinutesAsuncion(r.departure_time);
      return passesTimeWindowMinutes(mins, timeFilterFrom, timeFilterTo);
    });
  }, [rides, timeFilterFrom, timeFilterTo]);

  const groupsFiltered = useMemo(() => {
    return groups.filter((g) => {
      const mins = pickupTimeToMinutes(g.requested_time);
      return passesTimeWindowMinutes(mins, timeFilterFrom, timeFilterTo);
    });
  }, [groups, timeFilterFrom, timeFilterTo]);

  const markers = useMemo((): DispatchMapMarker[] => {
    const out: DispatchMapMarker[] = [];
    for (const tr of tripsFiltered) {
      const long = isLong(tr);
      if (long && !showLong) continue;
      if (!long && !showInternal) continue;
      const timeLine = tripTimeSubtitle(tr);
      const kind = long ? 'Larga distancia' : 'Interno';
      out.push({
        id: `${tr.id}-o`,
        lat: Number(tr.origin_lat),
        lng: Number(tr.origin_lng),
        color: COL.origin,
        title: `Origen · ${kind}`,
        subtitle: `${timeLine} · ${(tr.origin_label ?? 'Origen').slice(0, 40)} → ${(tr.destination_label ?? 'Destino').slice(0, 40)} · ${tr.status}`,
        placeName: (tr.origin_label ?? 'Origen').slice(0, 56),
        clientTimeHm: tripClientHm(tr.requested_time),
      });
      out.push({
        id: `${tr.id}-d`,
        lat: Number(tr.destination_lat),
        lng: Number(tr.destination_lng),
        color: COL.destination,
        title: `Destino · ${kind}`,
        subtitle: `${timeLine} · pedido ${tr.id.slice(0, 8)}…`,
        placeName: (tr.destination_label ?? 'Destino').slice(0, 56),
        clientTimeHm: tripClientHm(tr.requested_time_end ?? tr.requested_time),
      });
    }
    if (showSystem) {
      for (const r of ridesFiltered) {
        const when = new Date(r.departure_time).toLocaleString('es-PY', {
          timeZone: 'America/Asuncion',
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        });
        const rideHm = hmInAsuncionFromIso(r.departure_time);
        out.push({
          id: `${r.id}-o`,
          lat: Number(r.origin_lat),
          lng: Number(r.origin_lng),
          color: COL.origin,
          title: 'Origen · Generado por sistema',
          subtitle: `${when} · ${(r.origin_label ?? '').slice(0, 40)} → ${(r.destination_label ?? '').slice(0, 40)}`,
          placeName: (r.origin_label ?? 'Origen').slice(0, 56),
          clientTimeHm: rideHm,
        });
        out.push({
          id: `${r.id}-d`,
          lat: Number(r.destination_lat),
          lng: Number(r.destination_lng),
          color: COL.destination,
          title: 'Destino · Generado por sistema',
          subtitle: `${when} · ride ${r.id.slice(0, 8)}… · cupo ${r.available_seats ?? r.total_seats ?? '—'}`,
          placeName: (r.destination_label ?? 'Destino').slice(0, 56),
          clientTimeHm: rideHm,
        });
      }
    }
    if (showPassengerShortcuts) {
      /** Los atajos no usan el filtro de hora del mapa (es configuración recurrente, no un pedido puntual). */
      for (const s of passengerShortcuts) {
        const when = fmtWhen(s.scheduled_date, s.scheduled_time);
        const daily = s.schedule_daily ? ' · diario' : '';
        const route = `${(s.origin_label ?? 'Origen').slice(0, 36)} → ${(s.destination_label ?? 'Destino').slice(0, 36)}`;
        const uidShort = s.user_id.length >= 8 ? `${s.user_id.slice(0, 8)}…` : s.user_id;
        const shortcutHm = requestedTimeToHm(s.scheduled_time);
        out.push({
          id: `shortcut-${s.user_id}-${s.slot}-o`,
          lat: Number(s.origin_lat),
          lng: Number(s.origin_lng),
          color: COL.origin,
          title: 'Origen · Atajo app (switch activo)',
          subtitle: `${when}${daily} · ${shortcutSlotLabel(s.slot)} · ${route} · usr ${uidShort}`,
          placeName: (s.origin_label ?? 'Origen').slice(0, 56),
          clientTimeHm: shortcutHm,
        });
        out.push({
          id: `shortcut-${s.user_id}-${s.slot}-d`,
          lat: Number(s.destination_lat),
          lng: Number(s.destination_lng),
          color: COL.destination,
          title: 'Destino · Atajo app (switch activo)',
          subtitle: `${when}${daily} · ${shortcutSlotLabel(s.slot)} · usr ${uidShort}`,
          placeName: (s.destination_label ?? 'Destino').slice(0, 56),
          clientTimeHm: shortcutHm,
        });
      }
    }
    return out;
  }, [
    tripsFiltered,
    ridesFiltered,
    passengerShortcuts,
    showInternal,
    showLong,
    showSystem,
    showPassengerShortcuts,
  ]);

  const appendStop = useCallback(
    (m: DispatchMapMarker) => {
      setRouteStops((prev) => {
        const n = prev.length;
        const partnerId = dispatchMarkerPartnerId(m.id);
        const partner = partnerId ? markers.find((x) => x.id === partnerId) : undefined;
        if (partner) {
          const origin = m.id.endsWith('-o') ? m : partner;
          const dest = m.id.endsWith('-d') ? m : partner;
          return [
            ...prev,
            routeStopFromDispatchMarker(origin, String(n)),
            routeStopFromDispatchMarker(dest, String(n + 1)),
          ];
        }
        return [...prev, routeStopFromDispatchMarker(m, String(n))];
      });
    },
    [markers]
  );

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

  useEffect(() => {
    const waypoints = routeStops.map((s) => ({ lat: s.lat, lng: s.lng }));
    if (waypoints.length < 2) {
      setRoutePolyline([]);
      setRouteDurationMinutes(null);
      setRouteLineHint(null);
      setRouteLineLoading(false);
      return;
    }

    let cancelled = false;
    const straight = waypoints;

    const t = setTimeout(() => {
      void (async () => {
        if (cancelled) return;
        setRouteLineLoading(true);
        setRoutePolyline(straight);
        setRouteDurationMinutes(null);
        setRouteLineHint('Calculando ruta por calles (Google Routes)…');

        let token = accessToken ?? (await refetch()) ?? '';
        if (!token) {
          if (!cancelled) {
            setRouteLineLoading(false);
            setRouteDurationMinutes(null);
            setRouteLineHint('No hay sesión para calcular la ruta en el servidor.');
          }
          return;
        }

        try {
          let res = await fetch('/api/admin/dispatch-osrm-route', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ points: waypoints }),
          });
          if (res.status === 401) {
            token = (await refetch()) ?? '';
            if (token) {
              res = await fetch('/api/admin/dispatch-osrm-route', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ points: waypoints }),
              });
            }
          }
          const data = (await res.json()) as {
            polyline?: Array<{ lat: number; lng: number }>;
            source?: string;
            warning?: string;
            error?: string;
            durationSeconds?: number;
          };
          if (cancelled) return;
          if (!res.ok) {
            setRoutePolyline(straight);
            setRouteDurationMinutes(null);
            setRouteLineHint(typeof data.error === 'string' ? data.error : 'No se pudo obtener la ruta.');
            return;
          }
          if (Array.isArray(data.polyline) && data.polyline.length >= 2) {
            setRoutePolyline(data.polyline);
            const dm =
              data.source === 'google' &&
              typeof data.durationSeconds === 'number' &&
              Number.isFinite(data.durationSeconds) &&
              data.durationSeconds > 0
                ? Math.max(1, Math.round(data.durationSeconds / 60))
                : null;
            setRouteDurationMinutes(dm);
            setRouteLineHint(
              data.source === 'google' ? null : data.warning ?? 'Ruta aproximada (recta entre paradas).'
            );
          } else {
            setRoutePolyline(straight);
            setRouteDurationMinutes(null);
            setRouteLineHint('Respuesta inválida; línea recta entre paradas.');
          }
        } catch {
          if (!cancelled) {
            setRoutePolyline(straight);
            setRouteDurationMinutes(null);
            setRouteLineHint('Error de red al calcular la ruta.');
          }
        } finally {
          if (!cancelled) setRouteLineLoading(false);
        }
      })();
    }, 280);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [routeStops, accessToken, refetch]);

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
          <p className="text-xs text-sky-800 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2 mt-3 max-w-3xl">
            Los atajos Casa↔Trabajo con <strong>switch activo</strong> se guardan en la tabla{' '}
            <code className="bg-sky-100 px-1 rounded">passenger_home_map_shortcuts</code> (migración 065) con la sesión
            Supabase de la app (origen/destino con los mismos colores que el resto del mapa). Requieren coordenadas en el
            favorito. El resto de la vista sigue
            siendo solicitudes de viaje, demanda y viajes sistema.
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
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Hora desde (cliente)</label>
          <input
            type="time"
            value={timeFilterFrom}
            onChange={(e) => setTimeFilterFrom(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Hora hasta (cliente)</label>
          <input
            type="time"
            value={timeFilterTo}
            onChange={(e) => setTimeFilterTo(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <button type="button" onClick={() => void load()} className="btn-primary text-sm py-2 px-4" disabled={loading}>
          {loading ? 'Cargando…' : 'Actualizar datos'}
        </button>
      </div>
      <p className="text-xs text-gray-500 mb-3 -mt-2">
        El filtro de hora usa la hora que cargó el pasajero (<code className="bg-gray-100 px-1 rounded">requested_time</code>
        ). Si hay ventana en base, en el mapa verás también el fin de ventana / llegada máxima. Los{' '}
        <strong>atajos app</strong> (mismos colores origen/destino que el resto) no se filtran por esa hora: si hay filas
        en base, deberían verse siempre
        con el checkbox activo.
      </p>
      <p className="text-xs text-gray-700 mb-3 -mt-2">
        Atajos sincronizados (activos en base, este rango de carga):{' '}
        <strong>{passengerShortcuts.length}</strong>
        {passengerShortcuts.length === 0 && !loading ? (
          <span className="ml-2">
            — Si ya aplicaste la migración <code className="bg-gray-100 px-1 rounded">065</code>, abrí Inicio en la app
            (sesión iniciada, switch activo, pins en el mapa al guardar) y tocá Actualizar acá.
          </span>
        ) : null}
      </p>

      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <span className="text-xs text-gray-600 mr-2">
          Mapa: <span className="inline-block w-3 h-3 rounded-full align-middle ml-1 mr-0.5" style={{ background: COL.origin }} />
          origen
          <span className="inline-block w-3 h-3 rounded-full align-middle ml-2 mr-0.5" style={{ background: COL.destination }} />
          destino
          <span className="text-gray-500 ml-1">(incluye atajos app)</span>
        </span>
        <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={showInternal} onChange={(e) => setShowInternal(e.target.checked)} />
          <span className="font-medium text-gray-800">Internos</span>
        </label>
        <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={showLong} onChange={(e) => setShowLong(e.target.checked)} />
          <span className="font-medium text-gray-800">Larga distancia</span>
        </label>
        <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} />
          <span className="font-medium text-gray-800">Generados por sistema</span>
        </label>
        <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={showPassengerShortcuts}
            onChange={(e) => setShowPassengerShortcuts(e.target.checked)}
          />
          <span className="font-medium text-gray-800">Atajos app</span>
        </label>
      </div>

      {err && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>
      )}
      {passengerShortcutsLoadError && (
        <div className="mb-4 text-sm text-red-800 bg-red-50 border border-red-300 rounded-lg px-3 py-2">
          <strong>Atajos (Supabase):</strong> {passengerShortcutsLoadError}. Suele indicar que falta la migración{' '}
          <code className="bg-red-100 px-1 rounded">065_passenger_home_map_shortcuts.sql</code> en este proyecto, o un
          nombre de tabla distinto.
        </div>
      )}
      {actionMsg && (
        <div className="mb-4 text-sm text-gray-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{actionMsg}</div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 order-2 xl:order-1">
          <AdminDispatchMap
            markers={markers}
            routePolyline={routePolyline}
            routePolylineLoading={routeLineLoading}
            onMarkerDoubleClick={appendStop}
            height="min(70vh, 560px)"
          />
          <p className="text-xs text-gray-500 mt-2">
            <strong>Ruta manual:</strong> tocá un punto (origen o destino), abrí el globo y pulsá <strong>Añadir a la ruta</strong>, o
            hacé <strong>doble clic</strong> en el pin. En cada pedido, viaje sistema o atajo, <strong>un solo gesto suma origen y destino</strong>{' '}
            (el otro pin aparece en la lista al instante). La línea verde no bloquea los clics en los marcadores. La ruta sigue
            calles vía <strong>Google Routes</strong> (misma API que publicar / reservar en la web); si falla,
            verás rectas entre paradas. Zoom con +/− o la rueda.
          </p>
          {routeLineHint && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">{routeLineHint}</p>
          )}
        </div>
        <div className="space-y-4 order-1 xl:order-2 max-h-[85vh] overflow-y-auto pr-1">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="font-semibold text-gray-900 mb-2">Paradas de la ruta ({routeStops.length})</h2>
            {routeStops.length === 0 ? (
              <p className="text-sm text-gray-500">
                Todavía no añadiste puntos. Tocá un marcador en el mapa y en el globo elegí <strong>Añadir a la ruta</strong>.
              </p>
            ) : (
              <>
                <p className="text-xs text-gray-500 mb-3">
                  Por parada: <strong>lugar</strong>, <strong>hora cliente</strong> (dato del mapa) y <strong>hora en ruta</strong>{' '}
                  (se recalcula al sumar puntos: reparte el tiempo total del trazado verde entre tramos, anclada en la primera
                  parada con hora cliente).
                </p>
                <ul className="space-y-3 text-sm">
                  {routeStops.map((s, i) => (
                    <li key={s.key} className="flex flex-col gap-1.5 border-b border-gray-100 pb-3">
                      <div className="text-gray-900 font-semibold">
                        {i + 1}. {s.placeName?.trim() || 'Punto'}
                      </div>
                      <div className="text-xs text-gray-600">
                        Hora cliente:{' '}
                        <span className="font-medium text-gray-800">{s.clientTimeHm?.trim() || '—'}</span>
                      </div>
                      <div className="text-xs text-emerald-800">
                        Hora en ruta (estim.):{' '}
                        <span className="font-semibold">{routeStopEtas[i] ?? '—'}</span>
                      </div>
                      <div className="flex gap-2 pt-0.5">
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
              </>
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
            <h2 className="font-semibold text-gray-900 mb-2">Grupos de demanda ({groupsFiltered.length})</h2>
            <p className="text-xs text-gray-500 mb-3">
              Si el grupo tiene solicitudes en estado agrupado, podés generar el viaje del sistema desde aquí.
            </p>
            {groupsFiltered.length === 0 ? (
              <p className="text-sm text-gray-500">No hay grupos en el rango de fechas o en el filtro de hora.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {groupsFiltered.map((g) => (
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
