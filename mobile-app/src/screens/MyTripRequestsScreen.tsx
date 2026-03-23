/**
 * Mis solicitudes de trayecto (pasajero). Lista trip_requests del usuario, cancelar pendientes, ver viaje si aceptada.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../backend/supabase';
import { fetchMyTripRequests, cancelTripRequest } from '../rides/api';
import type { MainStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<MainStackParamList, 'MyTripRequests'>;

function shortLabel(label: string | null | undefined, max = 50): string {
  if (!label) return '—';
  const t = String(label).trim();
  return t.length <= max ? t : t.slice(0, max) + '…';
}

function requestStatusConfig(status: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    pending: { label: 'Pendiente', color: '#b45309' },
    accepted: { label: 'Aceptada', color: '#15803d' },
    expired: { label: 'Expirada', color: '#6b7280' },
    cancelled: { label: 'Cancelada', color: '#b91c1c' },
  };
  return map[status] ?? { label: status, color: '#6b7280' };
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('es-PY', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatTime(t: string | null | undefined): string {
  if (!t) return '—';
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '—';
}

export function MyTripRequestsScreen() {
  const navigation = useNavigation<Nav>();
  const { session } = useAuth();
  const [requests, setRequests] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.id) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      await supabase
        .from('trip_requests')
        .update({ status: 'expired', updated_at: new Date().toISOString() })
        .eq('user_id', session.id)
        .eq('status', 'pending')
        .lt('requested_date', today);

      const list = await fetchMyTripRequests(session.id);
      setRequests(list);
    } catch {
      setRequests([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session?.id]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      if (session?.id) load();
    }, [session?.id, load])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const handleCancel = useCallback(
    (id: string) => {
      if (!session?.id) return;
      Alert.alert(
        'Cancelar solicitud',
        '¿Estás seguro de que querés cancelar esta solicitud de trayecto?',
        [
          { text: 'No', style: 'cancel' },
          {
            text: 'Sí, cancelar',
            style: 'destructive',
            onPress: async () => {
              setCancellingId(id);
              try {
                await cancelTripRequest(id, session.id);
                setRequests((prev) =>
                  prev.map((r) => (r.id === id ? { ...r, status: 'cancelled' } : r))
                );
              } finally {
                setCancellingId(null);
              }
            },
          },
        ]
      );
    },
    [session?.id]
  );

  const renderItem = useCallback(
    ({ item }: { item: Record<string, unknown> }) => {
      const id = item.id as string;
      const status = (item.status as string) ?? '';
      const sc = requestStatusConfig(status);
      const canCancel = status === 'pending' && cancellingId !== id;
      const rideId = item.ride_id as string | null | undefined;
      return (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardRoute}>
              <Text style={styles.origin} numberOfLines={1}>
                {shortLabel(item.origin_label as string)}
              </Text>
              <Text style={styles.destination} numberOfLines={1}>
                → {shortLabel(item.destination_label as string)}
              </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: sc.color + '20' }]}>
              <Text style={[styles.badgeText, { color: sc.color }]}>{sc.label}</Text>
            </View>
          </View>
          <Text style={styles.meta}>
            {formatDate(item.requested_date as string)} · {formatTime(item.requested_time as string)} ·{' '}
            {Number(item.seats ?? 1)} asiento(s)
            {item.pricing_kind === 'long_distance' &&
            item.passenger_desired_price_per_seat_gs != null &&
            Number(item.passenger_desired_price_per_seat_gs) > 0
              ? ` · Hasta ${Number(item.passenger_desired_price_per_seat_gs).toLocaleString('es-PY')} Gs/asiento`
              : item.pricing_kind === 'internal'
                ? ' · Interno (cotizado)'
                : ''}
          </Text>
          <View style={styles.actions}>
            {status === 'accepted' && rideId && (
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => navigation.navigate('RideDetail', { rideId })}
              >
                <Text style={styles.primaryBtnText}>Ver viaje y reservar</Text>
              </TouchableOpacity>
            )}
            {canCancel && (
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => handleCancel(id)}
                disabled={cancellingId !== null}
              >
                <Text style={styles.cancelBtnText}>
                  {cancellingId === id ? 'Cancelando…' : 'Cancelar solicitud'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      );
    },
    [navigation, cancellingId, handleCancel]
  );

  if (loading && requests.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.newRequestBtn}
        onPress={() => navigation.navigate('SaveTripRequest', undefined)}
        accessibilityRole="button"
        accessibilityLabel="Guardar nueva solicitud de trayecto"
      >
        <Text style={styles.newRequestBtnText}>+ Guardar nueva solicitud</Text>
      </TouchableOpacity>
      <Text style={styles.intro}>
        Son trayectos que guardaste cuando no había viajes. Los conductores pueden ver las pendientes y publicar un
        viaje; si lo hacen, podés reservar.
      </Text>
      {requests.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No tenés solicitudes guardadas.</Text>
          <TouchableOpacity style={styles.searchLink} onPress={() => navigation.navigate('SearchPublishedRides')}>
            <Text style={styles.searchLinkText}>Buscar viajes publicados</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={requests}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  newRequestBtn: {
    backgroundColor: '#166534',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  newRequestBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  intro: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 16,
  },
  listContent: { paddingBottom: 24 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  cardRoute: { flex: 1, minWidth: 0 },
  origin: { fontSize: 15, fontWeight: '600', color: '#111' },
  destination: { fontSize: 14, color: '#6b7280', marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  meta: { fontSize: 13, color: '#6b7280', marginTop: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  primaryBtn: {
    backgroundColor: '#166534',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  primaryBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  cancelBtnText: { color: '#b91c1c', fontWeight: '600', fontSize: 14 },
  empty: { alignItems: 'center', paddingVertical: 32 },
  emptyText: { fontSize: 16, color: '#6b7280', marginBottom: 16 },
  searchLink: { backgroundColor: '#166534', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8 },
  searchLinkText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
