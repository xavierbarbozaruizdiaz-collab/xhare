/**
 * Tengo lugar: listado de mis disponibilidades (driver_ride_availability) + crear nueva.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../backend/supabase';
import { formatRideDate, formatRideTime } from '../ui/rideStatusConfig';
import type { MainStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<MainStackParamList, 'OfferTengo'>;

function short(s: string | null | undefined, max = 35): string {
  if (!s) return '—';
  const t = String(s).trim();
  return t.length <= max ? t : t.slice(0, max) + '…';
}

export function OfferTengoScreen() {
  const navigation = useNavigation<Nav>();
  const { session } = useAuth();
  const [list, setList] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!session?.id) return;
    try {
      const { data, error } = await supabase
        .from('driver_ride_availability')
        .select('id, origin_label, destination_label, departure_time, available_seats, status, suggested_price_per_seat, created_at')
        .eq('driver_id', session.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      setList(data ?? []);
    } catch {
      setList([]);
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

  if (loading && list.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('OfferTengoNew')}
      >
        <Text style={styles.fabText}>+ Publicar lugar</Text>
      </TouchableOpacity>
      <Text style={styles.hint}>
        Tus publicaciones "Tengo lugar". Los pasajeros pueden enviarte ofertas.
      </Text>
      {list.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No tenés publicaciones "Tengo lugar".</Text>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(item) => String(item.id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.route}>{short(item.origin_label as string)} → {short(item.destination_label as string)}</Text>
              <Text style={styles.meta}>
                {formatRideDate(item.departure_time as string)} · {formatRideTime(item.departure_time as string)} · {Number(item.available_seats ?? 1)} asiento(s)
                {(item.suggested_price_per_seat != null && Number(item.suggested_price_per_seat) > 0) ? ` · ${Number(item.suggested_price_per_seat).toLocaleString('es-PY')} Gs` : ''}
              </Text>
              <View style={[styles.badge, { backgroundColor: (item.status as string) === 'open' ? '#d1fae5' : '#f3f4f6' }]}>
                <Text style={styles.badgeText}>{(item.status as string) === 'open' ? 'Abierta' : String(item.status)}</Text>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  hint: { fontSize: 13, color: '#6b7280', marginBottom: 16 },
  listContent: { paddingBottom: 24 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: '#6b7280', fontSize: 15 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  route: { fontSize: 15, fontWeight: '600', color: '#111' },
  meta: { fontSize: 13, color: '#6b7280', marginTop: 4 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginTop: 8 },
  badgeText: { fontSize: 12, fontWeight: '600', color: '#374151' },
  fab: {
    backgroundColor: '#166534',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  fabText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
