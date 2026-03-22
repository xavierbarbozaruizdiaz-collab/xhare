/**
 * Pasajero: listado de rutas con demanda (lectura Supabase, misma fuente que conductor).
 * Tap → detalle → "Unirme a esta ruta" → marcar puntos en mapa.
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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { fetchDemandRoutes, type DemandRouteGroup } from '../backend/demandRoutesApi';
import { isEnvConfigured } from '../backend/supabase';
import type { MainStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<MainStackParamList, 'PassengerDemandRoutes'>;

function formatDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d + 'T12:00:00').toLocaleDateString('es-PY', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function formatTime(t: string | null | undefined): string {
  if (!t) return '—';
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '—';
}

export function PassengerDemandRoutesScreen() {
  const navigation = useNavigation<Nav>();
  const [groups, setGroups] = useState<DemandRouteGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const today = new Date().toISOString().slice(0, 10);
    if (!isEnvConfigured()) {
      setGroups([]);
      setError('Supabase no configurado en la app');
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const { groups: g, error: e } = await fetchDemandRoutes({ requested_date_from: today });
      setGroups(g ?? []);
      setError(e ?? null);
    } catch {
      setGroups([]);
      setError('No se pudo cargar las rutas. Revisá la conexión y la URL de la API.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const parentNav = navigation.getParent() as { navigate: (a: string, b?: object) => void } | undefined;

  if (loading && groups.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.searchPublishedBtn}
        onPress={() => parentNav?.navigate('SearchPublishedRides')}
        accessibilityRole="button"
        accessibilityLabel="Buscar viajes ya publicados por conductores"
      >
        <Text style={styles.searchPublishedBtnText}>Buscar viajes publicados</Text>
      </TouchableOpacity>
      <Text style={styles.intro}>
        Rutas con demanda agrupadas. Tocá una para ver el mapa y unirte marcando tu subida y bajada.
      </Text>
      {error && <Text style={styles.apiError}>{error}</Text>}
      {groups.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No hay rutas con demanda para mostrar.</Text>
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => parentNav?.navigate('PassengerRouteGroupDetail', { groupId: item.id })}
              accessibilityLabel={`Ruta ${item.origin_city ?? 'Origen'} a ${item.destination_city ?? 'Destino'}, ${item.passenger_count} pasajeros`}
              accessibilityRole="button"
            >
              <Text style={styles.origin} numberOfLines={1}>
                {item.origin_city ?? 'Origen'} → {item.destination_city ?? 'Destino'}
              </Text>
              <Text style={styles.meta}>
                {formatDate(item.requested_date)} · {formatTime(item.requested_time)} · {item.passenger_count} pasajero(s)
              </Text>
              <Text style={styles.hint}>Tocá para unirte</Text>
            </TouchableOpacity>
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  searchPublishedBtn: {
    backgroundColor: '#166534',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 14,
  },
  searchPublishedBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  intro: { fontSize: 14, color: '#6b7280', marginBottom: 16 },
  apiError: { fontSize: 13, color: '#b91c1c', marginBottom: 8 },
  listContent: { paddingBottom: 24 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  origin: { fontSize: 15, fontWeight: '600', color: '#111' },
  meta: { fontSize: 13, color: '#6b7280', marginTop: 8 },
  hint: { fontSize: 12, color: '#9ca3af', marginTop: 4 },
  empty: { alignItems: 'center', paddingVertical: 32 },
  emptyText: { fontSize: 16, color: '#6b7280' },
});
