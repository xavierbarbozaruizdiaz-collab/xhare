/**
 * Detalle de un viaje publicado: ruta, conductor, reservar.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { fetchRideForReserve } from '../rides/api';
import type { MainStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<MainStackParamList, 'RideDetail'>;
type ScreenRoute = RouteProp<MainStackParamList, 'RideDetail'>;

export function RideDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<ScreenRoute>();
  const { session } = useAuth();
  const { rideId } = route.params;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ride, setRide] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchRideForReserve(rideId);
      if (!res?.ride) {
        setError('Viaje no encontrado.');
        setRide(null);
        return;
      }
      setRide(res.ride);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar');
    } finally {
      setLoading(false);
    }
  }, [rideId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  if (error || !ride) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error ?? 'No disponible'}</Text>
        <TouchableOpacity style={styles.btn} onPress={() => navigation.goBack()}>
          <Text style={styles.btnText}>Volver</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const driver = ride.driver as { full_name?: string; rating_average?: number } | null;
  const isOwn = Boolean(session?.id && ride.driver_id === session.id);
  const available = Math.max(0, Number(ride.available_seats ?? 0));
  const dep = ride.departure_time ? new Date(String(ride.departure_time)).toLocaleString('es-PY') : '';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>
        {String(ride.origin_label ?? 'Origen')} → {String(ride.destination_label ?? 'Destino')}
      </Text>
      <Text style={styles.meta}>{dep}</Text>
      <Text style={styles.meta}>Asientos disponibles: {available}</Text>
      {driver ? (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Conductor</Text>
          <Text style={styles.cardValue}>{driver.full_name ?? '—'}</Text>
          {driver.rating_average != null && (
            <Text style={styles.meta}>★ {Number(driver.rating_average).toFixed(1)}</Text>
          )}
        </View>
      ) : null}

      {!isOwn && available > 0 && session?.id ? (
        <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.navigate('BookRide', { rideId })}>
          <Text style={styles.primaryBtnText}>Reservar asiento</Text>
        </TouchableOpacity>
      ) : null}
      {!isOwn && available < 1 ? <Text style={styles.muted}>Sin cupos disponibles.</Text> : null}
      {isOwn ? (
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => navigation.navigate('EditRide', { rideId })}>
          <Text style={styles.secondaryText}>Editar viaje</Text>
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity style={styles.secondaryBtn} onPress={() => navigation.goBack()}>
        <Text style={styles.secondaryText}>Volver</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, paddingBottom: 32 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  title: { fontSize: 20, fontWeight: '700', color: '#111' },
  meta: { fontSize: 14, color: '#6b7280', marginTop: 6 },
  card: { backgroundColor: '#f9fafb', padding: 14, borderRadius: 10, marginTop: 16 },
  cardLabel: { fontSize: 12, color: '#6b7280', textTransform: 'uppercase' },
  cardValue: { fontSize: 17, fontWeight: '600', marginTop: 4 },
  primaryBtn: {
    backgroundColor: '#166534',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 24,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondaryBtn: { marginTop: 14, alignItems: 'center', paddingVertical: 10 },
  secondaryText: { color: '#166534', fontWeight: '600', fontSize: 15 },
  muted: { marginTop: 16, color: '#6b7280' },
  errorText: { color: '#b91c1c', textAlign: 'center', marginBottom: 12 },
  btn: { backgroundColor: '#166534', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8 },
  btnText: { color: '#fff', fontWeight: '700' },
});
