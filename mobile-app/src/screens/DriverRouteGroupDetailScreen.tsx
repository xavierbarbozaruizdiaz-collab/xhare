/**
 * Conductor: detalle de una ruta agrupada (polyline base + puntos de pasajeros).
 * Mapa con ruta y marcadores; botón "Publicar viaje para esta ruta" → PublishRide con base_trip_request_id.
 */
import { appBrand } from '../ui/theme/brand';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import MapView, { Polyline, Marker } from 'react-native-maps';
import { androidMapProvider } from '../lib/androidMapProvider';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { fetchDemandRouteDetail, type DemandRouteDetail } from '../backend/demandRoutesApi';
import { fetchRoute, fetchSegmentStats } from '../backend/routeApi';
import {
  compareDemandRouteLegsStable,
  dedupeDemandRouteLegsForUi,
} from '../lib/demandRouteMembersDedupe';
import type { MainStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<MainStackParamList, 'DriverRouteGroupDetail'>;
type Route = RouteProp<MainStackParamList, 'DriverRouteGroupDetail'>;

function formatDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d + 'T12:00:00').toLocaleDateString('es-PY', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function formatTime(t: string | null): string {
  if (!t) return '—';
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '—';
}

function parseDateTime(dateStr: string | null | undefined, timeStr: string | null | undefined): Date | null {
  if (!dateStr || !timeStr) return null;
  const m = String(timeStr).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  const dt = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setHours(hh, mm, 0, 0);
  return dt;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + Math.round(minutes) * 60_000);
}

function formatClock(date: Date | null): string {
  if (!date) return '—';
  return date.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function legTimeKey(leg: { trip_request_id: string; stop_type: string; visit_order: number }): string {
  return `${String(leg.trip_request_id)}|${String(leg.stop_type)}|${Number(leg.visit_order)}`;
}
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const aa =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
}

/**
 * Margen operativo para hacer más exigente el horario:
 * el primer recojo se sugiere unos minutos antes del mínimo teórico.
 */
const FIRST_PICKUP_STRICT_BUFFER_MIN = 10;
const PASSENGER_ETA_TOLERANCE_MIN = 15;

/**
 * Varios Marker en la misma coordenada hacen que el mapa alterne cuál recibe el toque al abrir el globo
 * (parece que “cambia el número” sin cambiar el lugar). Agrupamos por punto + tipo de parada.
 */
function legCoordClusterKey(lat: number, lng: number, stopType: string): string {
  return `${String(stopType).toUpperCase()}|${lat.toFixed(5)}|${lng.toFixed(5)}`;
}

function getRegion(points: Array<{ lat: number; lng: number }>) {
  if (points.length === 0) {
    return { latitude: -25.3, longitude: -57.6, latitudeDelta: 0.5, longitudeDelta: 0.5 };
  }
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const padding = 0.01;
  return {
    latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
    longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    latitudeDelta: Math.max(0.02, Math.max(...lats) - Math.min(...lats) + padding * 2),
    longitudeDelta: Math.max(0.02, Math.max(...lngs) - Math.min(...lngs) + padding * 2),
  };
}

export function DriverRouteGroupDetailScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { groupId } = route.params;
  const [detail, setDetail] = useState<DemandRouteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completedVisitOrder, setCompletedVisitOrder] = useState(0);
  const [streetPolyline, setStreetPolyline] = useState<Array<{ lat: number; lng: number }> | null>(null);
  const [routeDurationMinutes, setRouteDurationMinutes] = useState<number | null>(null);
  const [cumulativeMinutesByLeg, setCumulativeMinutesByLeg] = useState<Record<string, number>>({});
  const [scheduleExpanded, setScheduleExpanded] = useState(false);
  const [passengerScheduleExpanded, setPassengerScheduleExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { detail: d, error: e } = await fetchDemandRouteDetail(groupId);
    setDetail(d ?? null);
    setError(e ?? null);
    setLoading(false);
  }, [groupId]);

  useEffect(() => {
    load();
  }, [load]);

  const allPoints = useMemo(() => {
    if (!detail) return [];
    const pts = [...(streetPolyline ?? detail.route_polyline ?? detail.base_polyline ?? [])];
    (detail.legs ?? []).forEach((l) => {
      if (typeof l.lat === 'number' && typeof l.lng === 'number') pts.push({ lat: l.lat, lng: l.lng });
    });
    if (!(detail.legs && detail.legs.length > 0)) {
      (detail.passengers ?? []).forEach((p) => {
        pts.push({ lat: p.origin_lat, lng: p.origin_lng });
        pts.push({ lat: p.destination_lat, lng: p.destination_lng });
      });
    }
    return pts;
  }, [detail, streetPolyline]);

  const region = useMemo(() => getRegion(allPoints), [allPoints]);
  const polylineCoords = useMemo(
    () =>
      (streetPolyline ?? detail?.route_polyline ?? detail?.base_polyline ?? []).map((p) => ({
        latitude: p.lat,
        longitude: p.lng,
      })),
    [streetPolyline, detail?.route_polyline, detail?.base_polyline]
  );
  const displayLegs = useMemo(() => {
    if ((detail?.legs?.length ?? 0) > 0) {
      const raw = [...(detail?.legs ?? [])];
      return raw.sort((a, b) =>
        compareDemandRouteLegsStable(
          {
            visit_order: Number(a.visit_order),
            trip_request_id: String(a.trip_request_id),
            stop_type: String(a.stop_type),
          },
          {
            visit_order: Number(b.visit_order),
            trip_request_id: String(b.trip_request_id),
            stop_type: String(b.stop_type),
          }
        )
      );
    }
    const ps = [...(detail?.passengers ?? [])].sort((a, b) =>
      String(a.trip_request_id).localeCompare(String(b.trip_request_id))
    );
    return ps.flatMap((p, i) => [
      {
        visit_order: i * 2 + 1,
        stop_type: 'PICKUP' as const,
        trip_request_id: p.trip_request_id,
        passenger_name: `Pasajero ${i + 1}`,
        label: p.origin_label ?? 'Origen',
        action: `Sube pasajero ${i + 1}`,
        fare_amount: null as number | null,
        lat: p.origin_lat,
        lng: p.origin_lng,
      },
      {
        visit_order: i * 2 + 2,
        stop_type: 'DROPOFF' as const,
        trip_request_id: p.trip_request_id,
        passenger_name: `Pasajero ${i + 1}`,
        label: p.destination_label ?? 'Destino',
        action: `Baja pasajero ${i + 1}`,
        fare_amount: null as number | null,
        lat: p.destination_lat,
        lng: p.destination_lng,
      },
    ]);
  }, [detail]);
  const sortedLegs = useMemo(
    () =>
      displayLegs
        .slice()
        .sort((a, b) =>
          compareDemandRouteLegsStable(
            {
              visit_order: Number(a.visit_order),
              trip_request_id: String(a.trip_request_id),
              stop_type: String(a.stop_type),
            },
            {
              visit_order: Number(b.visit_order),
              trip_request_id: String(b.trip_request_id),
              stop_type: String(b.stop_type),
            }
          )
        ),
    [displayLegs]
  );

  /** Un pin por (pasajero, tipo); evita superposición y el mapa alternando 2/3 al tocar. */
  const canonicalLegs = useMemo(
    () =>
      dedupeDemandRouteLegsForUi(
        sortedLegs.map((l) => ({
          ...l,
          trip_request_id: String(l.trip_request_id),
          stop_type: String(l.stop_type),
          visit_order: Number(l.visit_order),
        }))
      ),
    [sortedLegs]
  );

  const uiLegs = useMemo(() => {
    const ordered = [...canonicalLegs].sort((a, b) =>
      compareDemandRouteLegsStable(
        {
          visit_order: Number(a.visit_order),
          trip_request_id: String(a.trip_request_id),
          stop_type: String(a.stop_type),
        },
        {
          visit_order: Number(b.visit_order),
          trip_request_id: String(b.trip_request_id),
          stop_type: String(b.stop_type),
        }
      )
    );
    return ordered.map((l, i) => ({ ...l, uiStopNumber: i + 1 }));
  }, [canonicalLegs]);
  const timingLegs = useMemo(
    () =>
      canonicalLegs
        .filter(
          (l): l is (typeof canonicalLegs)[number] & { lat: number; lng: number } =>
            typeof l.lat === 'number' && typeof l.lng === 'number'
        )
        .sort((a, b) =>
          compareDemandRouteLegsStable(
            {
              visit_order: Number(a.visit_order),
              trip_request_id: String(a.trip_request_id),
              stop_type: String(a.stop_type),
            },
            {
              visit_order: Number(b.visit_order),
              trip_request_id: String(b.trip_request_id),
              stop_type: String(b.stop_type),
            }
          )
        ),
    [canonicalLegs]
  );

  /** Un pin por cluster (misma coordenada + tipo); evita el ciclo de callouts al tocar el mismo punto. */
  const mapMarkerSpecs = useMemo(() => {
    type Ui = (typeof uiLegs)[number];
    const withCoords = uiLegs.filter(
      (l): l is Ui & { lat: number; lng: number } =>
        typeof l.lat === 'number' && typeof l.lng === 'number'
    );
    const byKey = new Map<string, (Ui & { lat: number; lng: number })[]>();
    for (const l of withCoords) {
      const k = legCoordClusterKey(l.lat, l.lng, String(l.stop_type));
      const arr = byKey.get(k) ?? [];
      arr.push(l);
      byKey.set(k, arr);
    }
    const specs: Array<{
      clusterKey: string;
      coordinate: { latitude: number; longitude: number };
      title: string;
      description: string;
      pinColor: string;
      zIndex: number;
    }> = [];
    for (const [clusterKey, group] of byKey) {
      const sorted = [...group].sort((a, b) =>
        compareDemandRouteLegsStable(
          {
            visit_order: Number(a.visit_order),
            trip_request_id: String(a.trip_request_id),
            stop_type: String(a.stop_type),
          },
          {
            visit_order: Number(b.visit_order),
            trip_request_id: String(b.trip_request_id),
            stop_type: String(b.stop_type),
          }
        )
      );
      const first = sorted[0]!;
      const subida = first.stop_type !== 'DROPOFF';
      const nums = sorted.map((l) => l.uiStopNumber).join(', ');
      const title =
        sorted.length === 1
          ? `${first.uiStopNumber}. ${subida ? 'Subida' : 'Bajada'}`
          : `${sorted.length} ${subida ? 'subidas' : 'bajadas'} en el mismo punto (paradas ${nums})`;
      const description = sorted
        .map((l) => `${l.uiStopNumber}: ${l.passenger_name} · ${l.label}`)
        .join('\n');
      specs.push({
        clusterKey,
        coordinate: { latitude: first.lat, longitude: first.lng },
        title,
        description,
        pinColor: first.stop_type === 'DROPOFF' ? 'red' : 'green',
        zIndex: Math.max(...sorted.map((l) => Number(l.visit_order))),
      });
    }
    specs.sort((a, b) => a.zIndex - b.zIndex);
    return specs;
  }, [uiLegs]);

  useEffect(() => {
    let cancelled = false;
    setStreetPolyline(null);
    setRouteDurationMinutes(null);
    setCumulativeMinutesByLeg({});
    const routeLegs = timingLegs;
    if (routeLegs.length < 2) return;

    const origin = { lat: Number(routeLegs[0].lat), lng: Number(routeLegs[0].lng) };
    const destination = {
      lat: Number(routeLegs[routeLegs.length - 1].lat),
      lng: Number(routeLegs[routeLegs.length - 1].lng),
    };
    const waypoints = routeLegs
      .slice(1, -1)
      .map((l) => ({ lat: Number(l.lat), lng: Number(l.lng) }));

    void (async () => {
      const r = await fetchRoute(origin, destination, waypoints);
      if (cancelled) return;
      if (Number.isFinite(Number(r.durationMinutes)) && Number(r.durationMinutes) > 0) {
        setRouteDurationMinutes(Number(r.durationMinutes));
      }
      if (!r.error && !r.aborted && Array.isArray(r.polyline) && r.polyline.length >= 2) {
        setStreetPolyline(r.polyline);
      }

      const first = routeLegs[0]!;
      const cumulativeDurations = await Promise.all(
        routeLegs.map(async (leg, idx) => {
          if (idx === 0) return 0;
          const seg = await fetchSegmentStats(
            { lat: Number(first.lat), lng: Number(first.lng) },
            { lat: Number(leg.lat), lng: Number(leg.lng) },
            routeLegs
              .slice(1, idx)
              .map((wp) => ({ lat: Number(wp.lat), lng: Number(wp.lng) }))
          );
          const mins = Number(seg.durationMinutes);
          return Number.isFinite(mins) && mins >= 0 ? mins : null;
        })
      );
      if (cancelled) return;
      const allDurationsKnown = cumulativeDurations.every((m) => m != null);
      const totalDurationForFallback =
        Number.isFinite(Number(r.durationMinutes)) && Number(r.durationMinutes) > 0
          ? Number(r.durationMinutes)
          : routeDurationMinutes;
      const cumulativeGeoKm: number[] = [0];
      for (let i = 1; i < routeLegs.length; i++) {
        const prev = routeLegs[i - 1]!;
        const cur = routeLegs[i]!;
        cumulativeGeoKm.push(
          cumulativeGeoKm[i - 1]! +
            haversineKm(Number(prev.lat), Number(prev.lng), Number(cur.lat), Number(cur.lng))
        );
      }
      const totalGeoKm = cumulativeGeoKm[cumulativeGeoKm.length - 1] ?? 0;
      const byLeg: Record<string, number> = {};
      for (let i = 0; i < routeLegs.length; i++) {
        const exact = cumulativeDurations[i];
        if (exact != null) {
          byLeg[legTimeKey(routeLegs[i]!)] = exact;
          continue;
        }
        if (totalDurationForFallback != null && totalGeoKm > 0) {
          const ratio = (cumulativeGeoKm[i] ?? 0) / totalGeoKm;
          byLeg[legTimeKey(routeLegs[i]!)] = totalDurationForFallback * ratio;
        } else {
          byLeg[legTimeKey(routeLegs[i]!)] = 0;
        }
      }
      setCumulativeMinutesByLeg(byLeg);
    })();

    return () => {
      cancelled = true;
    };
  }, [timingLegs, routeDurationMinutes]);
  const currentLeg = useMemo(
    () => canonicalLegs.find((l) => l.visit_order > completedVisitOrder) ?? null,
    [canonicalLegs, completedVisitOrder]
  );
  /** Número de parada en la lista (1…N), no el visit_order crudo de la BD (puede tener huecos). */
  const currentLegSequenceNumber = useMemo(() => {
    if (!currentLeg) return null;
    const i = canonicalLegs.findIndex(
      (l) =>
        l.trip_request_id === currentLeg.trip_request_id &&
        l.stop_type === currentLeg.stop_type &&
        Number(l.visit_order) === Number(currentLeg.visit_order)
    );
    return i >= 0 ? i + 1 : null;
  }, [currentLeg, canonicalLegs]);
  const isRouteCompleted = currentLeg == null && canonicalLegs.length > 0;
  const financial = detail?.financial_summary;
  const desiredArrivalAt = useMemo(
    () => parseDateTime(detail?.requested_date ?? null, detail?.requested_time ?? null),
    [detail?.requested_date, detail?.requested_time]
  );
  const totalRouteMinutes = useMemo(() => {
    const lastLeg = timingLegs[timingLegs.length - 1];
    if (!lastLeg) return routeDurationMinutes ?? null;
    const v = cumulativeMinutesByLeg[legTimeKey(lastLeg)];
    if (Number.isFinite(v)) return Number(v);
    return routeDurationMinutes ?? null;
  }, [timingLegs, cumulativeMinutesByLeg, routeDurationMinutes]);
  const suggestedFirstPickupAt = useMemo(() => {
    if (!detail?.passengers || detail.passengers.length === 0) return null;
    const dropoffByTrip = new Map(
      timingLegs
        .filter((l) => String(l.stop_type).toUpperCase() === 'DROPOFF')
        .map((l) => [String(l.trip_request_id), l] as const)
    );
    const baseDate = detail.requested_date ?? null;
    const constraints: Array<{ minT0: number; maxT0: number; idealT0: number }> = [];
    for (const p of detail.passengers) {
      const tripId = String(p.trip_request_id);
      const dropoffLeg = dropoffByTrip.get(tripId);
      if (!dropoffLeg) continue;
      const offsetMin = cumulativeMinutesByLeg[legTimeKey(dropoffLeg)];
      if (!Number.isFinite(Number(offsetMin))) continue;
      const desired = parseDateTime(
        baseDate,
        (p as { requested_time?: string | null }).requested_time ?? detail.requested_time
      );
      if (!desired) continue;
      const desiredMs = desired.getTime();
      const idealT0 = desiredMs - Number(offsetMin) * 60_000;
      const minT0 = desiredMs - (Number(offsetMin) + PASSENGER_ETA_TOLERANCE_MIN) * 60_000;
      const maxT0 = desiredMs - (Number(offsetMin) - PASSENGER_ETA_TOLERANCE_MIN) * 60_000;
      constraints.push({ minT0, maxT0, idealT0 });
    }
    if (constraints.length === 0) {
      if (!desiredArrivalAt || !totalRouteMinutes) return null;
      return addMinutes(desiredArrivalAt, -(totalRouteMinutes + FIRST_PICKUP_STRICT_BUFFER_MIN));
    }
    const feasibleMin = Math.max(...constraints.map((c) => c.minT0));
    const feasibleMax = Math.min(...constraints.map((c) => c.maxT0));
    // Punto "justo": minimizar error global entre pasajeros (promedio de ideales).
    const meanIdeal =
      constraints.reduce((sum, c) => sum + c.idealT0, 0) / Math.max(1, constraints.length);
    // Objetivo operativo estricto (margen extra), usado solo como desempate suave.
    const strictTarget =
      desiredArrivalAt && totalRouteMinutes
        ? addMinutes(desiredArrivalAt, -(totalRouteMinutes + FIRST_PICKUP_STRICT_BUFFER_MIN)).getTime()
        : null;
    if (feasibleMin <= feasibleMax) {
      const fairTarget = clamp(meanIdeal, feasibleMin, feasibleMax);
      const center = (feasibleMin + feasibleMax) / 2;
      const strictClamped = strictTarget != null ? clamp(strictTarget, feasibleMin, feasibleMax) : null;
      const chosen =
        strictClamped != null && Math.abs(strictClamped - fairTarget) <= 2 * 60_000
          ? strictClamped
          : Math.abs(center - fairTarget) <= 2 * 60_000
            ? center
            : fairTarget;
      return new Date(chosen);
    }
    // Si no hay intersección global, usamos mejor compromiso (centro de la ventana "apretada").
    return new Date(Math.round((feasibleMin + feasibleMax) / 2));
  }, [
    detail?.passengers,
    detail?.requested_date,
    detail?.requested_time,
    timingLegs,
    cumulativeMinutesByLeg,
    desiredArrivalAt,
    totalRouteMinutes,
  ]);
  const estimatedArrivalAt = useMemo(() => {
    if (!suggestedFirstPickupAt || !totalRouteMinutes) return null;
    return addMinutes(suggestedFirstPickupAt, totalRouteMinutes);
  }, [suggestedFirstPickupAt, totalRouteMinutes]);
  const passengerSchedule = useMemo(() => {
    if (!detail?.passengers || detail.passengers.length === 0) return [];
    const dropoffByTrip = new Map(
      timingLegs
        .filter((l) => String(l.stop_type).toUpperCase() === 'DROPOFF')
        .map((l) => [String(l.trip_request_id), l] as const)
    );
    const nameByTrip = new Map(
      uiLegs.map((l) => [String(l.trip_request_id), String(l.passenger_name ?? '').trim()] as const)
    );
    return detail.passengers.map((p) => {
      const tripId = String(p.trip_request_id);
      const leg = dropoffByTrip.get(tripId);
      const cumulative = leg ? cumulativeMinutesByLeg[legTimeKey(leg)] : undefined;
      const desiredAt = parseDateTime(
        detail.requested_date,
        (p as { requested_time?: string | null }).requested_time ?? detail.requested_time
      );
      const estimatedAt =
        suggestedFirstPickupAt && Number.isFinite(Number(cumulative))
          ? addMinutes(suggestedFirstPickupAt, Number(cumulative))
          : null;
      const diffMinutes =
        desiredAt && estimatedAt ? Math.round((estimatedAt.getTime() - desiredAt.getTime()) / 60_000) : null;
      return {
        tripId,
        passengerName: nameByTrip.get(tripId) || `Pasajero ${tripId.slice(0, 6)}`,
        desiredAt,
        estimatedAt,
        diffMinutes,
      };
    });
  }, [detail, timingLegs, uiLegs, cumulativeMinutesByLeg, suggestedFirstPickupAt]);
  /** Solo tiene sentido tras materializar un viaje (ride_id en el grupo); no en vista previa de demanda. */
  const showLegProgress = Boolean(detail?.ride_id);

  const baseRequestId = detail?.base_trip_request_id ?? undefined;

  if (loading && !detail) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="appBrand.colors.primary" />
      </View>
    );
  }

  if (error || !detail) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error ?? 'No se pudo cargar la ruta'}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={load}>
          <Text style={styles.retryBtnText}>Reintentar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.meta}>
        <Text style={styles.title}>
          {(detail.origin_city || 'Origen')} → {detail.destination_city || 'Destino'}
        </Text>
        <Text style={styles.sub}>
          {formatDate(detail.requested_date)} · {formatTime(detail.requested_time)} ·{' '}
          {Number(financial?.total_passengers ?? detail.passenger_count ?? 0)} pasajero(s)
        </Text>
      </View>

      <View style={styles.mapWrap}>
        <MapView
          provider={androidMapProvider}
          style={styles.map}
          initialRegion={region}
          scrollEnabled
          zoomEnabled
        >
          {polylineCoords.length >= 2 && (
            <Polyline
              coordinates={polylineCoords}
              strokeColor="appBrand.colors.primary"
              strokeWidth={4}
            />
          )}
          {mapMarkerSpecs.map((spec) => (
            <Marker
              key={spec.clusterKey}
              coordinate={spec.coordinate}
              title={spec.title}
              description={spec.description}
              pinColor={spec.pinColor}
              zIndex={spec.zIndex}
              tracksViewChanges={false}
            />
          ))}
        </MapView>
      </View>
      <View style={styles.stopsCard}>
        <TouchableOpacity
          style={styles.sectionHeader}
          onPress={() => setScheduleExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel="Mostrar u ocultar horario objetivo"
        >
          <Text style={styles.stopsTitle}>Horario objetivo</Text>
          <Text style={styles.sectionChevron}>{scheduleExpanded ? '▲' : '▼'}</Text>
        </TouchableOpacity>
        {scheduleExpanded ? (
          <>
            <View style={styles.scheduleRow}>
              <Text style={styles.scheduleKey}>Hora deseada (pasajeros)</Text>
              <Text style={styles.scheduleValue}>{formatTime(detail.requested_time)}</Text>
            </View>
            <View style={styles.scheduleRow}>
              <Text style={styles.scheduleKey}>Duración estimada de ruta</Text>
              <Text style={styles.scheduleValue}>
                {totalRouteMinutes != null ? `${Math.round(totalRouteMinutes)} min` : 'Calculando...'}
              </Text>
            </View>
            <View style={styles.scheduleRow}>
              <Text style={styles.scheduleKey}>Recoger primer punto aprox.</Text>
              <Text style={styles.scheduleValue}>{formatClock(suggestedFirstPickupAt)}</Text>
            </View>
            <View style={styles.scheduleRow}>
              <Text style={styles.scheduleKey}>Llegada estimada</Text>
              <Text style={styles.scheduleValue}>{formatClock(estimatedArrivalAt)}</Text>
            </View>
          </>
        ) : null}
      </View>

      <View style={styles.stopsCard}>
        <TouchableOpacity
          style={styles.sectionHeader}
          onPress={() => setPassengerScheduleExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel="Mostrar u ocultar cumplimiento por pasajero"
        >
          <Text style={styles.stopsTitle}>Cumplimiento por pasajero (meta ±15 min)</Text>
          <Text style={styles.sectionChevron}>{passengerScheduleExpanded ? '▲' : '▼'}</Text>
        </TouchableOpacity>
        {passengerScheduleExpanded ? (
          passengerSchedule.length === 0 ? (
            <Text style={styles.stopsEmpty}>Sin datos por pasajero aún.</Text>
          ) : (
            passengerSchedule.map((row) => {
      const status =
                row.diffMinutes == null
                  ? 'Calculando...'
                : Math.abs(row.diffMinutes) <= PASSENGER_ETA_TOLERANCE_MIN
                    ? 'OK'
                    : row.diffMinutes > 0
                      ? 'Tarde'
                      : 'Muy temprano';
              return (
                <View key={row.tripId} style={styles.passengerScheduleRow}>
                  <Text style={styles.passengerScheduleName}>{row.passengerName}</Text>
                  <View style={styles.scheduleRow}>
                    <Text style={styles.scheduleKey}>Hora deseada</Text>
                    <Text style={styles.scheduleValue}>{formatClock(row.desiredAt)}</Text>
                  </View>
                  <View style={styles.scheduleRow}>
                    <Text style={styles.scheduleKey}>Hora estimada llegada</Text>
                    <Text style={styles.scheduleValue}>{formatClock(row.estimatedAt)}</Text>
                  </View>
                  <View style={styles.scheduleRow}>
                    <Text style={styles.scheduleKey}>Diferencia</Text>
                    <Text
                      style={[
                        styles.scheduleValue,
                        row.diffMinutes != null &&
                        Math.abs(row.diffMinutes) <= PASSENGER_ETA_TOLERANCE_MIN
                          ? styles.scheduleOk
                          : styles.scheduleWarn,
                      ]}
                    >
                      {row.diffMinutes == null
                        ? '—'
                        : `${row.diffMinutes > 0 ? '+' : ''}${row.diffMinutes} min (${status})`}
                    </Text>
                  </View>
                </View>
              );
            })
          )
        ) : null}
      </View>

      <View style={styles.stopsCard}>
        <Text style={styles.stopsTitle}>Paradas de la ruta</Text>
        {uiLegs.length === 0 ? (
          <Text style={styles.stopsEmpty}>Sin detalle de paradas aún.</Text>
        ) : (
          uiLegs.map((l) => (
              <View key={`${l.trip_request_id}-${l.stop_type}-${l.uiStopNumber}`} style={styles.stopRow}>
                <Text style={styles.stopOrder}>{l.uiStopNumber}.</Text>
                <View style={styles.stopBody}>
                  <Text style={styles.stopAction}>{l.action}</Text>
                  <Text style={styles.stopLabel}>{l.label}</Text>
                  {l.stop_type === 'PICKUP' ? (
                    <Text style={styles.stopFare}>
                      {l.fare_amount != null &&
                      Number.isFinite(Number(l.fare_amount)) &&
                      Number(l.fare_amount) > 0
                        ? `Cobrar: ${Math.round(Number(l.fare_amount)).toLocaleString('es-PY')} Gs`
                        : 'No se pudo calcular la tarifa de esta parada; avisá a soporte.'}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))
        )}
      </View>

      <View style={styles.financialCard}>
        <Text style={styles.financialTitle}>Resumen financiero</Text>
        <View style={styles.financialRow}>
          <Text style={styles.financialKey}>Total de pasajeros</Text>
          <Text style={styles.financialValue}>
            {Number(financial?.total_passengers ?? detail.passenger_count ?? 0)}
          </Text>
        </View>
        <View style={styles.financialRow}>
          <Text style={styles.financialKey}>Total a recaudar</Text>
          <Text style={styles.financialValue}>
            {Math.round(Number(financial?.total_to_collect_gs ?? 0)).toLocaleString('es-PY')} Gs
          </Text>
        </View>
        <View style={styles.financialRow}>
          <Text style={styles.financialKey}>Tu ganancia</Text>
          <Text style={[styles.financialValue, styles.financialGain]}>
            {Math.round(Number(financial?.driver_net_earnings_gs ?? 0)).toLocaleString('es-PY')} Gs
          </Text>
        </View>
        <Text style={styles.financialHint}>
          Comisión aplicada: {Number(financial?.driver_fee_percent ?? 10)}%
        </Text>
      </View>

      {showLegProgress && canonicalLegs.length > 0 ? (
        <TouchableOpacity
          style={[styles.primaryBtn, isRouteCompleted && styles.primaryBtnDisabled]}
          onPress={() => {
            if (!currentLeg) return;
            setCompletedVisitOrder(currentLeg.visit_order);
          }}
          disabled={isRouteCompleted}
          accessibilityRole="button"
          accessibilityLabel={
            isRouteCompleted
              ? 'Ruta completada'
              : currentLeg?.stop_type === 'PICKUP'
                ? 'Confirmar llegada a parada de subida'
                : 'Completar parada de bajada'
          }
        >
          <Text style={styles.primaryBtnText}>
            {isRouteCompleted
              ? 'Ruta completada'
              : currentLeg?.stop_type === 'PICKUP'
                ? `Llegué a parada ${currentLegSequenceNumber ?? currentLeg?.visit_order}`
                : `Completar parada ${currentLegSequenceNumber ?? currentLeg?.visit_order}`}
          </Text>
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity
        style={[styles.primaryBtn, styles.publishBtn]}
        onPress={() =>
          navigation.navigate('PublishRide', {
            tripRequestId: baseRequestId ?? undefined,
            groupId: detail.id,
              groupSuggestedPickupTime: suggestedFirstPickupAt ? formatClock(suggestedFirstPickupAt) : undefined,
          })
        }
        accessibilityLabel="Publicar viaje para esta ruta"
        accessibilityRole="button"
      >
        <Text style={styles.primaryBtnText}>Publicar viaje para esta ruta</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { color: '#b91c1c', marginBottom: 12, textAlign: 'center' },
  retryBtn: { backgroundColor: appBrand.colors.primary, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 },
  retryBtnText: { color: '#fff', fontWeight: '600' },
  meta: { marginBottom: 16 },
  title: { fontSize: 18, fontWeight: '600', color: '#111' },
  sub: { fontSize: 14, color: '#6b7280', marginTop: 4 },
  mapWrap: { width: '100%', height: 280, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#e5e7eb', marginBottom: 20 },
  map: { width: '100%', height: '100%' },
  stopsCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 12,
    marginBottom: 16,
  },
  stopsTitle: { fontSize: 15, fontWeight: '700', color: '#111', marginBottom: 8 },
  stopsEmpty: { color: '#6b7280', fontSize: 13 },
  stopRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  stopOrder: { width: 28, fontSize: 13, color: '#6b7280', fontWeight: '700' },
  stopBody: { flex: 1 },
  stopAction: { fontSize: 14, fontWeight: '600', color: '#111' },
  stopLabel: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  stopFare: { fontSize: 13, color: appBrand.colors.primaryMuted, marginTop: 2, fontWeight: '600' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionChevron: { fontSize: 12, color: '#6b7280', fontWeight: '700' },
  scheduleRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  scheduleKey: { fontSize: 13, color: '#374151' },
  scheduleValue: { fontSize: 13, color: '#111827', fontWeight: '700' },
  passengerScheduleRow: { borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 8, marginTop: 8 },
  passengerScheduleName: { fontSize: 14, fontWeight: '700', color: '#111827', marginBottom: 4 },
  scheduleOk: { color: appBrand.colors.primary },
  scheduleWarn: { color: '#b45309' },
  financialCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d1fae5',
    padding: 12,
    marginBottom: 16,
  },
  financialTitle: { fontSize: 15, fontWeight: '700', color: appBrand.colors.primaryMuted, marginBottom: 8 },
  financialRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  financialKey: { fontSize: 13, color: '#374151' },
  financialValue: { fontSize: 13, color: '#111827', fontWeight: '700' },
  financialGain: { color: appBrand.colors.primary },
  financialHint: { fontSize: 12, color: '#6b7280', marginTop: 4 },
  primaryBtn: {
    backgroundColor: appBrand.colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryBtnDisabled: { backgroundColor: '#9ca3af' },
  publishBtn: { backgroundColor: appBrand.colors.primary },
  primaryBtnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
