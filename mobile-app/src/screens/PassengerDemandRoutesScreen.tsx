/**
 * Pasajero: listado de rutas con demanda (lectura Supabase, misma fuente que conductor).
 * Tap → detalle → "Unirme a esta ruta" → marcar puntos en mapa.
 */
import { appBrand } from '../ui/theme/brand';
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
import { Ionicons } from '@expo/vector-icons';
import { fetchDemandRoutes, type DemandRouteGroup } from '../backend/demandRoutesApi';
import { isEnvConfigured } from '../backend/supabase';
import type { MainStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<MainStackParamList, 'PassengerDemandRoutes'>;

const PRIMARY = appBrand.colors.primary;
const PAGE_BG = '#f7f8fa';
const ICON_TILE_BG = '#edf7f1';

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

  const listHeader = (
    <View style={styles.headerBlock}>
      <Text style={styles.kicker}>EXPLORÁ</Text>
      <Text style={styles.leadTitle}>Demanda y viajes publicados</Text>
      <Text style={styles.leadSubtitle}>
        Buscá por código o recorrido, abrí la lista del día o revisá tus reservas.
      </Text>

      <TouchableOpacity
        style={styles.searchCard}
        onPress={() => parentNav?.navigate('SearchPublishedRides', {})}
        accessibilityRole="button"
        accessibilityLabel="Buscar viajes con filtros"
      >
        <Ionicons name="search" size={20} color="#9ca3af" style={styles.searchCardIcon} />
        <Text style={styles.searchCardPlaceholder}>Buscá un código o ruta…</Text>
      </TouchableOpacity>

      <View style={styles.quickRow}>
        <TouchableOpacity
          style={styles.quickTile}
          onPress={() => parentNav?.navigate('AvailableRides')}
          accessibilityRole="button"
          accessibilityLabel="Ver viajes disponibles publicados hoy"
        >
          <View style={styles.quickIconSquare}>
            <Ionicons name="car-outline" size={24} color={PRIMARY} />
          </View>
          <Text style={styles.quickTileLabel}>Viajes disponibles</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.quickTile}
          onPress={() => parentNav?.navigate('MyBookings')}
          accessibilityRole="button"
          accessibilityLabel="Ver mis reservas"
        >
          <View style={styles.quickIconSquare}>
            <Ionicons name="calendar-outline" size={24} color={PRIMARY} />
          </View>
          <Text style={styles.quickTileLabel}>Mis reservas</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionLabel}>RUTAS CON DEMANDA</Text>
      <Text style={styles.intro}>
        Varias solicitudes parecidas se agrupan acá. Para viajes ya publicados usá los accesos de arriba.
      </Text>
      {error ? <Text style={styles.apiError}>{error}</Text> : null}
      {loading && groups.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={PRIMARY} />
          <Text style={styles.loadingHint}>Cargando rutas…</Text>
        </View>
      ) : null}
    </View>
  );

  const emptyBody = (
    <View style={styles.empty}>
      <View style={styles.emptyIconWrap}>
        <Ionicons name="map-outline" size={40} color="#cbd5e1" />
      </View>
      <Text style={styles.emptyText}>No hay rutas con demanda para mostrar</Text>
      <Text style={styles.emptySub}>
        Eso no significa que no haya viajes: usá Viajes disponibles o el buscador para ver publicaciones.
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={groups}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={!loading && groups.length === 0 ? emptyBody : null}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => parentNav?.navigate('PassengerRouteGroupDetail', { groupId: item.id })}
            accessibilityLabel={`Ruta ${item.origin_city ?? 'Origen'} a ${item.destination_city ?? 'Destino'}, ${item.passenger_count} pasajeros`}
            accessibilityRole="button"
          >
            <View style={styles.cardTopRow}>
              <Text style={styles.origin} numberOfLines={2}>
                {item.origin_city ?? 'Origen'} → {item.destination_city ?? 'Destino'}
              </Text>
              <Ionicons name="chevron-forward" size={22} color="#94a3b8" style={styles.cardChevron} />
            </View>
            <Text style={styles.meta}>
              {formatDate(item.requested_date)} · {formatTime(item.requested_time)} · {item.passenger_count} pasajero(s)
            </Text>
            <Text style={styles.hint}>Tocá para ver detalle y unirte</Text>
          </TouchableOpacity>
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={PRIMARY}
          />
        }
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: PAGE_BG },
  headerBlock: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 4 },
  kicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.9,
    color: '#64748b',
    fontFamily: appBrand.fonts.semibold,
    marginBottom: 6,
  },
  leadTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    fontFamily: appBrand.fonts.semibold,
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  leadSubtitle: {
    fontSize: 14,
    color: '#64748b',
    lineHeight: 20,
    fontFamily: appBrand.fonts.regular,
    marginBottom: 18,
  },
  searchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e8eaed',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  searchCardIcon: { marginRight: 12 },
  searchCardPlaceholder: { flex: 1, fontSize: 15, color: '#9ca3af', fontFamily: appBrand.fonts.regular },
  quickRow: { flexDirection: 'row', gap: 12, marginBottom: 22 },
  quickTile: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#eef0f3',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  quickIconSquare: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: ICON_TILE_BG,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  quickTileLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
    fontFamily: appBrand.fonts.semibold,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.9,
    color: '#64748b',
    fontFamily: appBrand.fonts.semibold,
    marginBottom: 8,
  },
  intro: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 19,
    marginBottom: 12,
    fontFamily: appBrand.fonts.regular,
  },
  apiError: { fontSize: 13, color: '#b91c1c', marginBottom: 8, fontFamily: appBrand.fonts.medium },
  centered: { alignItems: 'center', paddingVertical: 28 },
  loadingHint: { marginTop: 12, fontSize: 14, color: '#64748b', fontFamily: appBrand.fonts.medium },
  listContent: { paddingHorizontal: 18, paddingBottom: 28, flexGrow: 1 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#eef0f3',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 8,
  },
  cardChevron: { marginTop: 2 },
  origin: { flex: 1, fontSize: 16, fontWeight: '800', color: '#0f172a', fontFamily: appBrand.fonts.semibold, lineHeight: 22 },
  meta: { fontSize: 13, color: '#64748b', marginTop: 8, fontFamily: appBrand.fonts.regular },
  hint: { fontSize: 12, color: PRIMARY, marginTop: 10, fontWeight: '700', fontFamily: appBrand.fonts.semibold },
  empty: { alignItems: 'center', paddingVertical: 24, paddingHorizontal: 8 },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#eef0f3',
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#475569',
    textAlign: 'center',
    fontFamily: appBrand.fonts.semibold,
  },
  emptySub: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 21,
    paddingHorizontal: 4,
    fontFamily: appBrand.fonts.regular,
  },
});
