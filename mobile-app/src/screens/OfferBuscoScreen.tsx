/**
 * Busco viaje: listado de mis solicitudes (passenger_ride_requests) + crear nueva.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../backend/supabase';
import type { MainStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<MainStackParamList, 'OfferBusco'>;

function short(s: string | null | undefined, max = 35): string {
  if (!s) return '—';
  const t = String(s).trim();
  return t.length <= max ? t : t.slice(0, max) + '…';
}

function formatDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d + 'T12:00:00').toLocaleDateString('es-PY', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function OfferBuscoScreen() {
  const navigation = useNavigation<Nav>();
  const { session } = useAuth();
  const [list, setList] = useState<Record<string, unknown>[]>([]);
  const parentNav = navigation.getParent() as { navigate: (a: string) => void } | undefined;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!session?.id) return;
    try {
      const { data, error } = await supabase
        .from('passenger_ride_requests')
        .select('id, origin_label, destination_label, requested_date, requested_time, seats, status, suggested_price_per_seat, created_at')
        .eq('user_id', session.id)
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
        onPress={() => parentNav?.navigate('OfferBuscoNew')}
      >
        <Text style={styles.fabText}>+ Nueva solicitud</Text>
      </TouchableOpacity>
      <Text style={styles.hint}>
        Tus solicitudes "Busco viaje". Los conductores pueden enviarte ofertas.
      </Text>
      {list.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No tenés solicitudes "Busco viaje".</Text>
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
                {formatDate(item.requested_date as string)} · {Number(item.seats ?? 1)} asiento(s)
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
