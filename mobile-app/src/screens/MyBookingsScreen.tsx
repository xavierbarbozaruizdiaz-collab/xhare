/**
 * Pasajero: reservas activas vs historial (viajes concretados / cancelados); tap → detalle del viaje.
 */
import React, { useCallback, useMemo, useState } from 'react';
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

function rideFromRow(row: Row): Record<string, unknown> | null {
  const r = row.ride;
  if (Array.isArray(r)) return asRecord(r[0]);
  return asRecord(r);
}

function isHistoryBooking(row: Row, ride: Record<string, unknown> | null): boolean {
  const bst = String(row.status ?? '');
  const rst = ride?.status != null ? String(ride.status) : '';
  if (bst === 'completed' || bst === 'cancelled') return true;
  if (rst === 'completed' || rst === 'cancelled') return true;
  return false;
}

function routeTitle(row: Row, ride: Record<string, unknown> | null): { line1: string; line2?: string } {
  const o = ride?.origin_label != null ? String(ride.origin_label).trim() : '';
  const d = ride?.destination_label != null ? String(ride.destination_label).trim() : '';
  if (o || d) {
    return { line1: `${o || 'Origen'} → ${d || 'Destino'}` };
  }
  const pu = row.pickup_label != null ? String(row.pickup_label).trim() : '';
  const dr = row.dropoff_label != null ? String(row.dropoff_label).trim() : '';
  if (pu || dr) {
    return {
      line1: 'Viaje (detalle guardado en tu reserva)',
      line2: `${pu || 'Subida'} → ${dr || 'Bajada'}`,
    };
  }
  return { line1: 'Viaje → —' };
}

export function MyBookingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList, 'MyBookings'>>();
  const { session } = useAuth();
  const [list, setList] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'active' | 'history'>('active');

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

  const { activeRows, historyRows } = useMemo(() => {
    const active: Row[] = [];
    const hist: Row[] = [];
    for (const row of list) {
      const ride = rideFromRow(row);
      if (isHistoryBooking(row, ride)) hist.push(row);
      else active.push(row);
    }
    return { activeRows: active, historyRows: hist };
  }, [list]);

  const shownRows = tab === 'active' ? activeRows : historyRows;

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
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === 'active' && styles.tabActive]}
          onPress={() => setTab('active')}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'active' }}
        >
          <Text style={[styles.tabText, tab === 'active' && styles.tabTextActive]}>Activas</Text>
          {activeRows.length > 0 ? <Text style={styles.tabBadge}>{activeRows.length}</Text> : null}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'history' && styles.tabActive]}
          onPress={() => setTab('history')}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'history' }}
        >
          <Text style={[styles.tabText, tab === 'history' && styles.tabTextActive]}>Historial</Text>
          {historyRows.length > 0 ? <Text style={styles.tabBadge}>{historyRows.length}</Text> : null}
        </TouchableOpacity>
      </View>
      <Text style={styles.tabHint}>
        {tab === 'active'
          ? 'Próximos viajes y reservas en curso.'
          : 'Viajes concretados o cancelados y reservas cerradas.'}
      </Text>
      <FlatList
        data={shownRows}
        keyExtractor={(item, index) => String(item.id ?? `booking-${index}`)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={shownRows.length === 0 ? styles.emptyContainer : styles.listContent}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {tab === 'active'
              ? 'No tenés reservas activas. Buscá viajes desde Inicio o la pestaña Pasajero.'
              : 'Todavía no hay viajes en tu historial. Cuando un viaje termine, vas a verlo acá.'}
          </Text>
        }
        renderItem={({ item }) => {
          const ride = rideFromRow(item);
          const rideId = ride?.id != null ? String(ride.id) : String(item.ride_id ?? '');
          const { line1, line2 } = routeTitle(item, ride);
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
              accessibilityLabel={`Reserva ${line1}`}
            >
              <View style={styles.cardHeader}>
                <View style={styles.routeBlock}>
                  <Text style={styles.route} numberOfLines={2}>
                    {line1}
                  </Text>
                  {line2 ? (
                    <Text style={styles.routeSub} numberOfLines={2}>
                      {line2}
                    </Text>
                  ) : null}
                </View>
                <View style={[styles.pill, { borderColor: bCfg.color }]}>
                  <Text style={[styles.pillText, { color: bCfg.color }]}>{bCfg.label}</Text>
                </View>
              </View>
              <Text style={styles.meta}>
                Salida: {depIso ? `${formatRideDate(depIso)} · ${formatRideTime(depIso)}` : '— · —'}
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
  tabs: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 12,
    gap: 8,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  tabActive: {
    borderColor: '#166534',
    backgroundColor: '#f0fdf4',
  },
  tabText: { fontSize: 14, fontWeight: '600', color: '#6b7280' },
  tabTextActive: { color: '#166534' },
  tabBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
    backgroundColor: '#dcfce7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  tabHint: {
    fontSize: 12,
    color: '#9ca3af',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    lineHeight: 17,
  },
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
  routeBlock: { flex: 1 },
  route: { fontSize: 16, fontWeight: '700', color: '#111', lineHeight: 22 },
  routeSub: { fontSize: 13, color: '#6b7280', marginTop: 4, lineHeight: 18 },
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
