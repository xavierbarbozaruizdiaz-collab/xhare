/**
 * Pasajero: lista de reservas propias; tap → detalle del viaje (con bloque "Tu reserva").
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { fetchMyBookings } from '../rides/api';
import type { MainStackParamList } from '../navigation/types';
import { bookingStatusConfig, formatRideDate, formatRideTime } from '../ui/rideStatusConfig';

type Row = Record<string, unknown>;

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  return raw as Record<string, unknown>;
}

/** Supabase puede devolver el join `ride` como objeto o array de un elemento. */
function rideFromRow(row: Row): Record<string, unknown> | null {
  const r = row.ride;
  if (Array.isArray(r)) return asRecord(r[0]);
  return asRecord(r);
}

export function MyBookingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList, 'MyBookings'>>();
  const { session } = useAuth();
  const [list, setList] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.id) {
      setList([]);
      setError(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setError(null);
    try {
      const rows = await fetchMyBookings(session.id);
      setList((rows as Row[]) ?? []);
    } catch (e) {
      setList([]);
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las reservas.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session?.id]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  if (!session?.id) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>Iniciá sesión para ver tus reservas.</Text>
      </View>
    );
  }

  if (loading && list.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={list}
        keyExtractor={(item, index) => String(item.id ?? `booking-${index}`)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={list.length === 0 ? styles.emptyContainer : styles.listContent}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            Todavía no tenés reservas. Buscá viajes desde Inicio o la pestaña Pasajero.
          </Text>
        }
        renderItem={({ item }) => {
          const ride = rideFromRow(item);
          const rideId = ride?.id != null ? String(ride.id) : String(item.ride_id ?? '');
          const origin = String(ride?.origin_label ?? 'Viaje');
          const dest = String(ride?.destination_label ?? '—');
          const depIso = ride?.departure_time != null ? String(ride.departure_time) : '';
          const seats = Math.max(1, Number(item.seats_count ?? 1));
          const price = Number(item.price_paid ?? 0);
          const st = String(item.status ?? '');
          const bCfg = bookingStatusConfig(st);
          const cancelled = st === 'cancelled';

          return (
            <TouchableOpacity
              style={[styles.card, cancelled && styles.cardCancelled]}
              onPress={() => {
                if (rideId) navigation.navigate('RideDetail', { rideId });
              }}
              disabled={!rideId}
              accessibilityRole="button"
              accessibilityLabel={`Reserva ${origin} a ${dest}`}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.route} numberOfLines={2}>
                  {origin} → {dest}
                </Text>
                <View style={[styles.pill, { borderColor: bCfg.color }]}>
                  <Text style={[styles.pillText, { color: bCfg.color }]}>{bCfg.label}</Text>
                </View>
              </View>
              <Text style={styles.meta}>
                Salida: {formatRideDate(depIso)} · {formatRideTime(depIso)}
              </Text>
              <Text style={styles.meta}>
                {seats} asiento{seats !== 1 ? 's' : ''} · {price.toLocaleString('es-PY')} PYG
              </Text>
              {rideId ? <Text style={styles.hint}>Tocá para ver el viaje y tu reserva</Text> : null}
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  listContent: { padding: 16, paddingBottom: 32 },
  emptyContainer: { flexGrow: 1, padding: 24, justifyContent: 'center' },
  emptyText: { fontSize: 15, color: '#6b7280', textAlign: 'center', lineHeight: 22 },
  error: { margin: 16, color: '#b91c1c', fontSize: 14 },
  muted: { fontSize: 15, color: '#6b7280' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  cardCancelled: { opacity: 0.72, backgroundColor: '#f9fafb' },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  route: { flex: 1, fontSize: 16, fontWeight: '700', color: '#111', lineHeight: 22 },
  pill: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    flexShrink: 0,
  },
  pillText: { fontSize: 11, fontWeight: '700' },
  meta: { fontSize: 13, color: '#6b7280', marginTop: 8 },
  hint: { fontSize: 12, color: '#166534', marginTop: 10, fontWeight: '600' },
});
