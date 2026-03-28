/**
 * Pasajero: viajes en curso cerca (corona conductor + ruta OSRM a ≤1 km). Lista + mapa; Reservar → BookRide.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  RefreshControl,
} from 'react-native';
import MapView, { Polyline, Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { androidMapProvider } from '../lib/androidMapProvider';
import {
  fetchNearbyEnRouteRides,
  type NearbyEnRouteRide,
  type NearbyEnRouteCriteria,
} from '../rides/api';
import type { MainStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<MainStackParamList, 'NearbyEnRouteRides'>;

const POLY_COLORS = ['#166534', '#1d4ed8', '#b45309', '#7c3aed', '#be123c', '#0f766e'];

function routeLabel(r: NearbyEnRouteRide): string {
  const o = r.origin_label?.trim() || 'Origen';
  const d = r.destination_label?.trim() || 'Destino';
  return `${o} → ${d}`;
}

export function NearbyEnRouteRidesScreen() {
  const navigation = useNavigation<Nav>();
  const mapRef = useRef<MapView>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rides, setRides] = useState<NearbyEnRouteRide[]>([]);
  const [criteria, setCriteria] = useState<NearbyEnRouteCriteria | null>(null);
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) {
      setPermissionDenied(true);
      setLoading(false);
      setRefreshing(false);
      setRides([]);
      setCriteria(null);
      return;
    }
    setPermissionDenied(false);
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    setUserLoc({ lat, lng });

    const result = await fetchNearbyEnRouteRides(lat, lng);
    if (!result.ok) {
      setError(result.error);
      setRides([]);
      setCriteria(null);
      setSelectedId(null);
    } else {
      setRides(result.rides);
      setCriteria(result.criteria);
      setSelectedId((prev) => {
        if (prev && result.rides.some((r) => r.id === prev)) return prev;
        return result.rides[0]?.id ?? null;
      });
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load])
  );

  const region = useMemo(() => {
    if (!userLoc) {
      return { latitude: -25.3, longitude: -57.6, latitudeDelta: 0.08, longitudeDelta: 0.08 };
    }
    return {
      latitude: userLoc.lat,
      longitude: userLoc.lng,
      latitudeDelta: 0.055,
      longitudeDelta: 0.055,
    };
  }, [userLoc]);

  useEffect(() => {
    if (!userLoc || rides.length === 0) return;
    const coords = [
      { latitude: userLoc.lat, longitude: userLoc.lng },
      ...rides.map((r) => ({ latitude: r.driver_lat, longitude: r.driver_lng })),
    ];
    const t = setTimeout(() => {
      mapRef.current?.fitToCoordinates(coords, {
        edgePadding: { top: 64, right: 48, bottom: 200, left: 48 },
        animated: true,
      });
    }, 400);
    return () => clearTimeout(t);
  }, [userLoc, rides]);

  const criteriaLine = criteria
    ? `Ruta a ≤${Math.round(criteria.route_within_m / 100) / 10} km de vos · conductor entre ${criteria.driver_between_m[0] / 1000} y ${criteria.driver_between_m[1] / 1000} km · con asientos libres`
    : '';

  if (permissionDenied) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Necesitamos tu ubicación para buscar viajes en curso cerca.</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={load}>
          <Text style={styles.retryBtnText}>Otorgar ubicación</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (loading && !userLoc) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#166534" />
        <Text style={styles.hintLoad}>Obteniendo ubicación…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.mapWrap}>
        <MapView
          ref={mapRef}
          provider={androidMapProvider}
          style={styles.map}
          initialRegion={region}
          showsUserLocation
          showsMyLocationButton={false}
          scrollEnabled
          zoomEnabled
        >
          {rides.map((r, i) => {
            const coords = r.polyline.map((p) => ({ latitude: p.lat, longitude: p.lng }));
            const color = POLY_COLORS[i % POLY_COLORS.length];
            const thick = r.id === selectedId;
            return (
              <React.Fragment key={r.id}>
                {coords.length >= 2 && (
                  <Polyline
                    coordinates={coords}
                    strokeColor={color}
                    strokeWidth={thick ? 5 : 3}
                    lineDashPattern={thick ? undefined : [12, 8]}
                  />
                )}
                <Marker
                  coordinate={{ latitude: r.driver_lat, longitude: r.driver_lng }}
                  title="Conductor"
                  description={routeLabel(r)}
                  pinColor={thick ? 'blue' : 'gray'}
                  onPress={() => setSelectedId(r.id)}
                />
              </React.Fragment>
            );
          })}
        </MapView>
      </View>

      <View style={styles.panel}>
        <Text style={styles.criteria}>{criteriaLine}</Text>
        {error ? <Text style={styles.errorBanner}>{error}</Text> : null}
        {loading && userLoc ? (
          <View style={styles.inlineLoading}>
            <ActivityIndicator color="#166534" />
            <Text style={styles.hintLoad}>Buscando…</Text>
          </View>
        ) : null}
        {!loading && rides.length === 0 && !error ? (
          <Text style={styles.empty}>
            No hay viajes en curso que cumplan los criterios cerca de tu ubicación. Podés intentar más tarde o
            ampliar la búsqueda desde Buscar viajes.
          </Text>
        ) : null}
        <FlatList
          data={rides}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#166534']} />}
          renderItem={({ item }) => {
            const sel = item.id === selectedId;
            return (
              <TouchableOpacity
                style={[styles.card, sel && styles.cardSelected]}
                onPress={() => setSelectedId(item.id)}
                activeOpacity={0.85}
              >
                <Text style={styles.cardTitle}>{routeLabel(item)}</Text>
                <Text style={styles.cardMeta}>
                  Ruta ~{item.distance_route_m} m · Conductor ~{(item.distance_driver_m / 1000).toFixed(1)} km ·{' '}
                  {item.available_seats} asiento(s)
                  {item.price_per_seat != null && item.price_per_seat > 0
                    ? ` · Gs ${Math.round(item.price_per_seat)}`
                    : ''}
                </Text>
                <TouchableOpacity
                  style={styles.reserveBtn}
                  onPress={() => navigation.navigate('BookRide', { rideId: item.id })}
                >
                  <Text style={styles.reserveBtnText}>Reservar asiento</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            );
          }}
          ListFooterComponent={<View style={{ height: 24 }} />}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  mapWrap: { height: 240, width: '100%' },
  map: { flex: 1 },
  panel: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  criteria: { fontSize: 12, color: '#64748b', marginBottom: 10, lineHeight: 17 },
  errorText: { color: '#b91c1c', textAlign: 'center', marginBottom: 12 },
  errorBanner: { color: '#b91c1c', marginBottom: 8, fontSize: 14 },
  retryBtn: { backgroundColor: '#166534', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 },
  retryBtnText: { color: '#fff', fontWeight: '600' },
  hintLoad: { marginTop: 8, color: '#64748b', fontSize: 14 },
  inlineLoading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  empty: { fontSize: 14, color: '#475569', marginBottom: 12, lineHeight: 20 },
  card: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    backgroundColor: '#fafafa',
  },
  cardSelected: { borderColor: '#166534', backgroundColor: '#f0fdf4' },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  cardMeta: { fontSize: 13, color: '#64748b', marginTop: 4 },
  reserveBtn: {
    marginTop: 10,
    alignSelf: 'flex-start',
    backgroundColor: '#166534',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  reserveBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});
