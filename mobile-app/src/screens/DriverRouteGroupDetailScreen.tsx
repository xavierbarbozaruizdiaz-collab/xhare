/**
 * Conductor: detalle de una ruta agrupada (polyline base + puntos de pasajeros).
 * Mapa con ruta y marcadores; botón "Publicar viaje para esta ruta" → PublishRide con base_trip_request_id.
 */
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
import { fetchRoute } from '../backend/routeApi';
import { dedupeDemandRouteLegsForUi } from '../lib/demandRouteMembersDedupe';
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
  const displayLegs = useMemo(
    () =>
      (detail?.legs?.length ?? 0) > 0
        ? (detail?.legs ?? [])
        : (detail?.passengers ?? []).flatMap((p, i) => [
            {
              visit_order: i * 2 + 1,
              stop_type: 'PICKUP' as const,
              trip_request_id: p.trip_request_id,
              passenger_name: `Pasajero ${i + 1}`,
              label: p.origin_label ?? 'Origen',
              action: `Sube pasajero ${i + 1}`,
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
              lat: p.destination_lat,
              lng: p.destination_lng,
            },
          ]),
    [detail]
  );
  const sortedLegs = useMemo(
    () =>
      displayLegs
        .slice()
        .sort((a, b) => a.visit_order - b.visit_order),
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
    const ordered = [...canonicalLegs].sort((a, b) => a.visit_order - b.visit_order);
    return ordered.map((l, i) => ({ ...l, uiStopNumber: i + 1 }));
  }, [canonicalLegs]);

  useEffect(() => {
    let cancelled = false;
    setStreetPolyline(null);
    const routeLegs = canonicalLegs.filter(
      (l) => typeof l.lat === 'number' && typeof l.lng === 'number'
    );
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
      if (!r.error && !r.aborted && Array.isArray(r.polyline) && r.polyline.length >= 2) {
        setStreetPolyline(r.polyline);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canonicalLegs]);
  const currentLeg = useMemo(
    () => canonicalLegs.find((l) => l.visit_order > completedVisitOrder) ?? null,
    [canonicalLegs, completedVisitOrder]
  );
  const isRouteCompleted = currentLeg == null && canonicalLegs.length > 0;
  const financial = detail?.financial_summary;
  /** Solo tiene sentido tras materializar un viaje (ride_id en el grupo); no en vista previa de demanda. */
  const showLegProgress = Boolean(detail?.ride_id);

  const baseRequestId = detail?.base_trip_request_id ?? undefined;

  if (loading && !detail) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#166534" />
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
          {formatDate(detail.requested_date)} · {formatTime(detail.requested_time)} · {detail.passenger_count} pasajero(s)
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
              strokeColor="#166534"
              strokeWidth={4}
            />
          )}
          {uiLegs
            .filter((l) => typeof l.lat === 'number' && typeof l.lng === 'number')
            .map((l) => (
              <Marker
                key={`${l.trip_request_id}-${l.stop_type}`}
                coordinate={{ latitude: l.lat as number, longitude: l.lng as number }}
                title={`${l.uiStopNumber}. ${l.stop_type === 'DROPOFF' ? 'Bajada' : 'Subida'}`}
                description={`${l.passenger_name} · ${l.label}`}
                pinColor={l.stop_type === 'DROPOFF' ? 'red' : 'green'}
              />
            ))}
        </MapView>
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
                        : 'Sin precio cargado en el pedido (acordar con el pasajero).'}
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
                ? `Llegué a parada ${currentLeg?.visit_order}`
                : `Completar parada ${currentLeg?.visit_order}`}
          </Text>
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity
        style={[styles.primaryBtn, styles.publishBtn]}
        onPress={() =>
          navigation.navigate('PublishRide', {
            tripRequestId: baseRequestId ?? undefined,
            groupId: detail.id,
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
  retryBtn: { backgroundColor: '#166534', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 },
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
  stopFare: { fontSize: 13, color: '#065f46', marginTop: 2, fontWeight: '600' },
  financialCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d1fae5',
    padding: 12,
    marginBottom: 16,
  },
  financialTitle: { fontSize: 15, fontWeight: '700', color: '#065f46', marginBottom: 8 },
  financialRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  financialKey: { fontSize: 13, color: '#374151' },
  financialValue: { fontSize: 13, color: '#111827', fontWeight: '700' },
  financialGain: { color: '#166534' },
  financialHint: { fontSize: 12, color: '#6b7280', marginTop: 4 },
  primaryBtn: {
    backgroundColor: '#166534',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryBtnDisabled: { backgroundColor: '#9ca3af' },
  publishBtn: { backgroundColor: '#14532d' },
  primaryBtnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
