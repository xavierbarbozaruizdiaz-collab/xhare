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
    const pts = [...(detail.base_polyline ?? [])];
    (detail.passengers ?? []).forEach((p) => {
      pts.push({ lat: p.origin_lat, lng: p.origin_lng });
      pts.push({ lat: p.destination_lat, lng: p.destination_lng });
    });
    return pts;
  }, [detail]);

  const region = useMemo(() => getRegion(allPoints), [allPoints]);
  const polylineCoords = useMemo(
    () => (detail?.base_polyline ?? []).map((p) => ({ latitude: p.lat, longitude: p.lng })),
    [detail?.base_polyline]
  );

  const parentNav = navigation.getParent() as { navigate: (a: string, b?: object) => void } | undefined;
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
          {(detail.passengers ?? []).map((p, i) => (
            <React.Fragment key={p.trip_request_id}>
              <Marker
                coordinate={{ latitude: p.origin_lat, longitude: p.origin_lng }}
                title={`Recogida ${i + 1}`}
                pinColor="green"
              />
              <Marker
                coordinate={{ latitude: p.destination_lat, longitude: p.destination_lng }}
                title={`Bajada ${i + 1}`}
                pinColor="red"
              />
            </React.Fragment>
          ))}
        </MapView>
      </View>

      <TouchableOpacity
        style={styles.primaryBtn}
        onPress={() =>
          parentNav?.navigate('PublishRide', {
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
  primaryBtn: {
    backgroundColor: '#166534',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
