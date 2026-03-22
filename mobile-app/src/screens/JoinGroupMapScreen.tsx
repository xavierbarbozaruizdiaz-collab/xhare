/**
 * Pasajero: unirse a una ruta con demanda. Marcar subida y bajada en el mapa (≤2 km del corredor, orden correcto).
 * Al confirmar: guarda trip_request con fecha/hora/ciudad del grupo para que el sync lo asigne.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { fetchDemandRouteDetail, type DemandRouteDetail } from '../backend/demandRoutesApi';
import { reverseGeocodeStructured } from '../backend/geocodeApi';
import { fetchRoute } from '../backend/routeApi';
import { saveTripRequest } from '../rides/api';
import { PickupDropoffMapView, type MapPoint } from '../components/PickupDropoffMapView';
import { distancePointToPolylineMeters, getPositionAlongPolyline } from '../lib/geo';
import { PROXIMITY_METERS } from '../lib/geo';
import type { MainStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<MainStackParamList, 'JoinGroupMap'>;
type Route = RouteProp<MainStackParamList, 'JoinGroupMap'>;

function normalizeTime(t: string | null | undefined): string {
  if (!t) return '08:00';
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '08:00';
}

export function JoinGroupMapScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { session } = useAuth();
  const { groupId } = route.params;
  const [detail, setDetail] = useState<DemandRouteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickup, setPickup] = useState<MapPoint>(null);
  const [dropoff, setDropoff] = useState<MapPoint>(null);
  const [done, setDone] = useState(false);

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

  const baseRoute = (detail?.base_polyline ?? []) as Array<{ lat: number; lng: number }>;

  const onConfirm = useCallback(async () => {
    if (!session?.id || !detail || !pickup || !dropoff) return;
    if (baseRoute.length < 2) {
      Alert.alert('Error', 'No hay ruta base para validar.');
      return;
    }
    const distPickup = distancePointToPolylineMeters(pickup, baseRoute);
    const distDropoff = distancePointToPolylineMeters(dropoff, baseRoute);
    if (distPickup > PROXIMITY_METERS || distDropoff > PROXIMITY_METERS) {
      Alert.alert(
        'Puntos lejos de la ruta',
        `Tu subida y bajada deben estar a menos de ${PROXIMITY_METERS / 1000} km del corredor. Ajustá los puntos en el mapa.`
      );
      return;
    }
    const posPickup = getPositionAlongPolyline(pickup, baseRoute);
    const posDropoff = getPositionAlongPolyline(dropoff, baseRoute);
    if (posPickup >= posDropoff) {
      Alert.alert('Orden incorrecto', 'La subida debe ser antes que la bajada en la ruta. Ajustá los puntos.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const [originPlace, destPlace, routeResult] = await Promise.all([
        reverseGeocodeStructured(pickup.lat, pickup.lng),
        reverseGeocodeStructured(dropoff.lat, dropoff.lng),
        fetchRoute({ lat: pickup.lat, lng: pickup.lng }, { lat: dropoff.lat, lng: dropoff.lng }, []),
      ]);
      const routePolyline = routeResult.polyline && routeResult.polyline.length >= 2 ? routeResult.polyline : null;
      const routeLengthKm = routeResult.distanceKm ?? null;

      const result = await saveTripRequest({
        userId: session.id,
        originLat: pickup.lat,
        originLng: pickup.lng,
        originLabel: originPlace.displayName.slice(0, 500),
        destinationLat: dropoff.lat,
        destinationLng: dropoff.lng,
        destinationLabel: destPlace.displayName.slice(0, 500),
        requestedDate: detail.requested_date,
        requestedTime: normalizeTime(detail.requested_time),
        seats: 1,
        originCity: detail.origin_city ?? originPlace.city ?? null,
        originDepartment: (detail as { origin_department?: string | null }).origin_department ?? originPlace.department ?? null,
        originBarrio: originPlace.barrio ?? null,
        destinationCity: detail.destination_city ?? destPlace.city ?? null,
        destinationDepartment: (detail as { destination_department?: string | null }).destination_department ?? destPlace.department ?? null,
        destinationBarrio: destPlace.barrio ?? null,
        routePolyline: routePolyline ?? null,
        routeLengthKm: routeLengthKm ?? null,
      });
      if (result.ok) setDone(true);
      else setError(result.error ?? 'No se pudo guardar.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  }, [session?.id, detail, pickup, dropoff, baseRoute]);

  if (loading && !detail) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  if (error && !detail) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  if (done) {
    return (
      <View style={styles.centered}>
        <Text style={styles.doneTitle}>Listo</Text>
        <Text style={styles.doneText}>
          Tu solicitud quedó guardada con la misma fecha y hora que esta ruta. Cuando un conductor actualice las rutas, aparecerás en este grupo.
        </Text>
        <TouchableOpacity
          style={styles.doneBtn}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.doneBtnText}>Volver</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!detail || baseRoute.length < 2) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>No se pudo cargar la ruta.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.hint}>
        Marcá en el mapa tu punto de subida (A) y bajada (B). Deben estar a menos de 2 km del corredor y en orden.
      </Text>
      <PickupDropoffMapView
        baseRoute={baseRoute}
        pickup={pickup}
        dropoff={dropoff}
        onPickupChange={setPickup}
        onDropoffChange={setDropoff}
        height={320}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <TouchableOpacity
        style={[styles.confirmBtn, (saving || !pickup || !dropoff) && styles.confirmBtnDisabled]}
        onPress={onConfirm}
        disabled={saving || !pickup || !dropoff}
      >
        <Text style={styles.confirmBtnText}>
          {saving ? 'Guardando…' : 'Confirmar y unirme'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  hint: { fontSize: 14, color: '#6b7280', marginBottom: 12 },
  errorText: { color: '#b91c1c', marginTop: 8, textAlign: 'center' },
  confirmBtn: {
    backgroundColor: '#166534',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
  },
  confirmBtnDisabled: { opacity: 0.6 },
  confirmBtnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  doneTitle: { fontSize: 20, fontWeight: '700', color: '#111', marginBottom: 12 },
  doneText: { fontSize: 15, color: '#374151', textAlign: 'center', marginBottom: 24 },
  doneBtn: { backgroundColor: '#166534', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8 },
  doneBtnText: { color: '#fff', fontWeight: '600' },
});
