/**
 * Solicitudes de viaje (conductor): pestañas Viajes disponibles / Ofertas de viajes / De sistema.
 * "De sistema" agrupa rutas generadas por el motor de agrupación + viajes awaiting_driver.
 */
import { appBrand } from '../ui/theme/brand';
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
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../backend/supabase';
import {
  buildRideIdToDemandGroupMap,
  fetchDemandRoutes,
  syncDemandRoutes,
  type DemandRouteGroup,
} from '../backend/demandRoutesApi';
import { raceWithTimeout } from '../backend/withTimeout';
import { env } from '../core/env';
import type { MainStackParamList } from '../navigation/types';
import {
  fetchMyRides,
  fetchAwaitingDriverRides,
  fetchAcceptedTripRequestSeatsByRide,
} from '../rides/api';
import { SystemGeneratedRideCard, type SystemGeneratedRideRow } from '../components/SystemGeneratedRideCard';

type Nav = NativeStackNavigationProp<MainStackParamList, 'DriverTripRequests'>;

type RequestTab = 'internal' | 'long_distance' | 'system';
type SystemSubTab = 'hex' | 'interior';

type InternalListItem =
  | { kind: 'group'; g: DemandRouteGroup }
  | { kind: 'request'; r: Record<string, unknown> };
type SystemListItem =
  | { kind: 'group'; g: DemandRouteGroup }
  | { kind: 'ride'; r: SystemGeneratedRideRow };

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('es-PY', {
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

function shortLabel(label: string | null | undefined, max = 45): string {
  if (!label) return '—';
  const s = String(label).trim();
  return s.length <= max ? s : s.slice(0, max) + '…';
}

const SUPABASE_QUERY_TIMEOUT_MS = 35_000;

const TAB_LABELS: Record<RequestTab, string> = {
  internal: 'Viajes disponibles',
  long_distance: 'Ofertas de viajes',
  system: 'De sistema',
};
const SYSTEM_SUBTAB_LABELS: Record<SystemSubTab, string> = {
  hex: 'Hex',
  interior: 'Interior',
};

function isHexSystemGroup(g: DemandRouteGroup): boolean {
  const src = String(g.grouping_source ?? '').trim().toLowerCase();
  return src === 'hex_bucket' || src === 'hex';
}

export function DriverTripRequestsScreen() {
  const navigation = useNavigation<Nav>();
  const { session } = useAuth();
  const [groups, setGroups] = useState<DemandRouteGroup[]>([]);
  const [fallbackRequests, setFallbackRequests] = useState<Record<string, unknown>[]>([]);
  const [systemRides, setSystemRides] = useState<SystemGeneratedRideRow[]>([]);
  const [systemSeats, setSystemSeats] = useState<Record<string, number>>({});
  const [systemRideGroupByRideId, setSystemRideGroupByRideId] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<RequestTab>('internal');
  const [activeSystemSubTab, setActiveSystemSubTab] = useState<SystemSubTab>('hex');

  const load = useCallback(async () => {
    const trace = (...args: unknown[]) => {
      if (__DEV__) console.log('[DriverTripRequests]', ...args);
    };
    trace('load:start', { hasSessionId: Boolean(session?.id), hasApiBase: Boolean(env.apiBaseUrl?.trim()) });

    if (!session?.id) {
      trace('load:abort no session.id');
      setLoading(false);
      setRefreshing(false);
      setGroups([]);
      setFallbackRequests([]);
      setSystemRides([]);
      setSystemSeats({});
      setSystemRideGroupByRideId({});
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    setApiError(null);

    try {
      const sbQuery = supabase
        .from('trip_requests')
        .select(
          'id, origin_label, destination_label, requested_date, requested_time, seats, created_at, pricing_kind, passenger_desired_price_per_seat_gs'
        )
        .eq('status', 'pending')
        .gte('requested_date', today)
        .order('requested_date', { ascending: true })
        .order('created_at', { ascending: false })
        .limit(200);

      const [routesResult, sbResult, myRidesList, awaitingRaw] = await Promise.all([
        fetchDemandRoutes({ requested_date_from: today }),
        raceWithTimeout(
          sbQuery,
          SUPABASE_QUERY_TIMEOUT_MS,
          () =>
            ({
              data: null,
              error: {
                message:
                  'Tiempo de espera al cargar solicitudes. Revisá conexión y credenciales de Supabase.',
              },
            }) as Awaited<typeof sbQuery>
        ),
        fetchMyRides(session.id).catch(() => []),
        fetchAwaitingDriverRides().catch((e) => {
          if (__DEV__) console.warn('[DriverTripRequests] awaiting rides fetch', e);
          return [];
        }),
      ]);

      trace('load:parallel done');

      if (routesResult.error) {
        setApiError(routesResult.error);
        setGroups([]);
      } else {
        setGroups(routesResult.groups ?? []);
      }

      const { data: trData, error: sbError } = sbResult;
      if (!sbError) setFallbackRequests(trData ?? []);
      else {
        setFallbackRequests([]);
        setApiError((prev) => prev ?? sbError.message);
      }

      const ownIds = new Set((myRidesList as { id: string }[]).map((r) => r.id));
      const rawAwaiting = awaitingRaw as SystemGeneratedRideRow[];
      if (__DEV__) {
        console.log('[RIDES AWAITING][Solicitudes]', rawAwaiting);
      }
      const filteredAwaiting = rawAwaiting.filter((r) => !ownIds.has(r.id));
      setSystemRides(filteredAwaiting);
      const dIds = filteredAwaiting.map((r) => r.id);
      const seatsMap =
        dIds.length > 0 ? await fetchAcceptedTripRequestSeatsByRide(dIds).catch(() => ({})) : {};
      setSystemSeats(seatsMap as Record<string, number>);
      if (dIds.length > 0) {
        const byRide = await buildRideIdToDemandGroupMap(dIds.map((id) => String(id)));
        setSystemRideGroupByRideId(byRide);
      } else {
        setSystemRideGroupByRideId({});
      }
    } catch (e) {
      trace('load:catch', e);
      setApiError(e instanceof Error ? e.message : 'Error al cargar solicitudes');
      setGroups([]);
      setFallbackRequests([]);
      setSystemRides([]);
      setSystemSeats({});
      setSystemRideGroupByRideId({});
    } finally {
      setLoading(false);
      setRefreshing(false);
      trace('load:finally');
    }
  }, [session?.id]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (env.apiBaseUrl?.trim()) {
      await syncDemandRoutes();
    }
    await load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const internalRequests = useMemo(
    () =>
      fallbackRequests.filter((r) => (r.pricing_kind as string | undefined) !== 'long_distance'),
    [fallbackRequests]
  );

  const longRequests = useMemo(
    () =>
      fallbackRequests.filter((r) => (r.pricing_kind as string | undefined) === 'long_distance'),
    [fallbackRequests]
  );

  const systemEligibleGroups = useMemo(
    () => groups.filter((g) => Number(g.passenger_count ?? 0) >= 2),
    [groups]
  );
  const systemSingleGroups = useMemo(
    () => groups.filter((g) => Number(g.passenger_count ?? 0) < 2),
    [groups]
  );
  const systemHexGroups = useMemo(
    () => systemEligibleGroups.filter((g) => isHexSystemGroup(g)),
    [systemEligibleGroups]
  );
  const systemInteriorGroups = useMemo(
    () => systemEligibleGroups.filter((g) => !isHexSystemGroup(g)),
    [systemEligibleGroups]
  );

  const internalListData: InternalListItem[] = useMemo(() => {
    const rows: InternalListItem[] = internalRequests.map((r) => ({ kind: 'request', r }));
    for (const g of systemSingleGroups) rows.unshift({ kind: 'group', g });
    return rows;
  }, [internalRequests, systemSingleGroups]);

  const systemListData: SystemListItem[] = useMemo(() => {
    const visibleGroups = activeSystemSubTab === 'hex' ? systemHexGroups : systemInteriorGroups;
    const rows: SystemListItem[] = visibleGroups.map((g) => ({ kind: 'group', g }));
    const materializedRideIds = new Set(
      visibleGroups
        .map((g) => String(g.ride_id ?? '').trim())
        .filter((id) => id.length > 0)
    );
    for (const r of systemRides) {
      const rid = String((r as { id?: string }).id ?? '').trim();
      if (materializedRideIds.has(rid)) continue;
      rows.push({ kind: 'ride', r });
    }
    return rows;
  }, [activeSystemSubTab, systemHexGroups, systemInteriorGroups, systemRides]);

  const renderInternalItem = useCallback(
    ({ item }: { item: InternalListItem }) => {
      if (item.kind === 'group') {
        const g = item.g;
        return (
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('DriverRouteGroupDetail', { groupId: g.id })}
            accessibilityLabel={`Ruta ${g.origin_city ?? 'Origen'} a ${g.destination_city ?? 'Destino'}, ${g.passenger_count} pasajeros`}
            accessibilityRole="button"
          >
            <View style={styles.kindBadgeRow}>
              <Text style={[styles.kindBadge, styles.kindBadgeInternal]}>Sistema (1)</Text>
            </View>
            <Text style={styles.origin} numberOfLines={1}>
              {g.origin_city ?? 'Origen'} → {g.destination_city ?? 'Destino'}
            </Text>
            <Text style={styles.meta}>
              {formatDate(g.requested_date)} · {formatTime(g.requested_time)} · {g.passenger_count} pasajero(s)
            </Text>
          </TouchableOpacity>
        );
      }
      const r = item.r;
      const reqId = r.id as string;
      return (
        <View style={styles.card}>
          <View style={styles.kindBadgeRow}>
            <Text style={[styles.kindBadge, styles.kindBadgeInternal]}>Disponible</Text>
          </View>
          <Text style={styles.origin} numberOfLines={1}>
            {shortLabel(r.origin_label as string)}
          </Text>
          <Text style={styles.destination} numberOfLines={1}>
            → {shortLabel(r.destination_label as string)}
          </Text>
          <Text style={styles.meta}>
            {formatDate(r.requested_date as string)} · {formatTime(r.requested_time as string)} ·{' '}
            {Number(r.seats ?? 1)} asiento(s)
          </Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() =>
              navigation.navigate('PublishRide', { tripRequestId: reqId, publishKind: 'internal' })
            }
            accessibilityLabel="Crear ruta para solicitud disponible"
            accessibilityRole="button"
          >
            <Text style={styles.primaryBtnText}>Crear ruta</Text>
          </TouchableOpacity>
        </View>
      );
    },
    [navigation]
  );

  const renderLongItem = useCallback(
    ({ item: r }: { item: Record<string, unknown> }) => {
      const reqId = r.id as string;
      return (
        <View style={styles.card}>
          <View style={styles.kindBadgeRow}>
            <Text style={[styles.kindBadge, styles.kindBadgeLong]}>Oferta de viaje</Text>
          </View>
          <Text style={styles.origin} numberOfLines={1}>
            {shortLabel(r.origin_label as string)}
          </Text>
          <Text style={styles.destination} numberOfLines={1}>
            → {shortLabel(r.destination_label as string)}
          </Text>
          <Text style={styles.meta}>
            {formatDate(r.requested_date as string)} · {formatTime(r.requested_time as string)} ·{' '}
            {Number(r.seats ?? 1)} asiento(s)
            {r.passenger_desired_price_per_seat_gs != null &&
            Number(r.passenger_desired_price_per_seat_gs) > 0
              ? ` · Pasajero: hasta ${Number(r.passenger_desired_price_per_seat_gs).toLocaleString('es-PY')} Gs/asiento`
              : null}
          </Text>
          <TouchableOpacity
            style={styles.longDistBtn}
            onPress={() => navigation.navigate('TripRequestLongDistanceOffer', { tripRequestId: reqId })}
            accessibilityLabel="Contraoferta y precios de otros conductores"
            accessibilityRole="button"
          >
            <Text style={styles.longDistBtnText}>Contraoferta y precios de otros</Text>
          </TouchableOpacity>
        </View>
      );
    },
    [navigation]
  );

  const introForTab = useMemo(() => {
    if (activeTab === 'internal') {
      return 'Viajes disponibles: solicitudes pendientes + grupos de sistema que quedaron con menos de 2 solicitudes.';
    }
    if (activeTab === 'long_distance') {
      return 'Ofertas de viajes: ofertá precio y compará con otros conductores.';
    }
    if (activeSystemSubTab === 'hex') {
      return 'De sistema / Hex: rutas agrupadas por hexágonos (mínimo 2 solicitudes).';
    }
    return 'De sistema / Interior: rutas agrupadas por cercanía (mínimo 2 solicitudes).';
  }, [activeTab, activeSystemSubTab]);

  if (loading && !refreshing) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={appBrand.colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.myRidesBtn}
        onPress={() => navigation.navigate('MyPublishedRides')}
        accessibilityRole="button"
        accessibilityLabel="Ver mis viajes publicados"
      >
        <Text style={styles.myRidesBtnText}>Mis viajes publicados</Text>
      </TouchableOpacity>

      <View style={styles.tabRow}>
        {(['internal', 'long_distance', 'system'] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tabBtn, activeTab === tab && styles.tabBtnActive]}
            onPress={() => {
              setActiveTab(tab);
              if (tab !== 'system') setActiveSystemSubTab('hex');
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: activeTab === tab }}
            accessibilityLabel={TAB_LABELS[tab]}
          >
            <Text style={[styles.tabBtnText, activeTab === tab && styles.tabBtnTextActive]}>
              {TAB_LABELS[tab]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.intro}>{introForTab}</Text>

      {apiError && <Text style={styles.apiError}>{apiError}</Text>}

      {activeTab === 'internal' ? (
        <FlatList
          style={styles.list}
          data={internalListData}
          keyExtractor={(item) =>
            item.kind === 'group' ? `sys1_${item.g.id}` : `req_${String(item.r.id)}`
          }
          renderItem={renderInternalItem}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No hay solicitudes disponibles pendientes.</Text>
              <Text style={styles.emptyHint}>Estirá hacia abajo para actualizar.</Text>
            </View>
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              colors={[appBrand.colors.primary]}
              tintColor={appBrand.colors.primary}
            />
          }
          contentContainerStyle={[
            styles.listContent,
            internalListData.length === 0 ? styles.listContentEmpty : null,
          ]}
        />
      ) : null}

      {activeTab === 'long_distance' ? (
        <FlatList
          style={styles.list}
          data={longRequests}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderLongItem}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No hay ofertas de viajes pendientes.</Text>
              <Text style={styles.emptyHint}>Estirá hacia abajo para actualizar.</Text>
            </View>
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              colors={[appBrand.colors.primary]}
              tintColor={appBrand.colors.primary}
            />
          }
          contentContainerStyle={[
            styles.listContent,
            longRequests.length === 0 ? styles.listContentEmpty : null,
          ]}
        />
      ) : null}

      {activeTab === 'system' ? (
        <FlatList
          style={styles.list}
          data={systemListData}
          keyExtractor={(item) => (item.kind === 'group' ? `g_${item.g.id}` : `r_${item.r.id}`)}
          ListHeaderComponent={
            <View>
              <View style={styles.systemSubtabRow}>
                {(['hex', 'interior'] as const).map((sub) => (
                  <TouchableOpacity
                    key={sub}
                    style={[styles.systemSubtabBtn, activeSystemSubTab === sub && styles.systemSubtabBtnActive]}
                    onPress={() => setActiveSystemSubTab(sub)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: activeSystemSubTab === sub }}
                    accessibilityLabel={SYSTEM_SUBTAB_LABELS[sub]}
                  >
                    <Text
                      style={[
                        styles.systemSubtabBtnText,
                        activeSystemSubTab === sub && styles.systemSubtabBtnTextActive,
                      ]}
                    >
                      {SYSTEM_SUBTAB_LABELS[sub]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.systemSectionTitle}>Rutas y viajes de sistema</Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.systemEmptyWrap}>
              <Text style={styles.emptyText}>
                No hay rutas o viajes de sistema para {activeSystemSubTab === 'hex' ? 'Hex' : 'Interior'}.
              </Text>
              <Text style={styles.emptyHint}>Estirá hacia abajo para actualizar.</Text>
            </View>
          }
          renderItem={({ item }) =>
            item.kind === 'group' ? (
              <TouchableOpacity
                style={styles.card}
                onPress={() => navigation.navigate('DriverRouteGroupDetail', { groupId: item.g.id })}
                accessibilityLabel={`Ruta ${item.g.origin_city ?? 'Origen'} a ${item.g.destination_city ?? 'Destino'}, ${item.g.passenger_count} pasajeros`}
                accessibilityRole="button"
              >
                <Text style={styles.origin} numberOfLines={1}>
                  {item.g.origin_city ?? 'Origen'} → {item.g.destination_city ?? 'Destino'}
                </Text>
                <Text style={styles.meta}>
                  {formatDate(item.g.requested_date)} · {formatTime(item.g.requested_time)} · {item.g.passenger_count}{' '}
                  pasajero(s)
                </Text>
                <Text style={styles.hint}>Tocá para ver el mapa y publicar un viaje</Text>
              </TouchableOpacity>
            ) : (
              <SystemGeneratedRideCard
                r={item.r}
                passengerSeats={systemSeats[item.r.id] ?? 0}
                onOpenDetail={() => {
                  const groupId = systemRideGroupByRideId[item.r.id];
                  if (groupId) {
                    navigation.navigate('DriverRouteGroupDetail', { groupId });
                    return;
                  }
                  navigation.navigate('PublishRide', {
                    fromRideId: item.r.id,
                    publishKind: 'internal',
                  });
                }}
              />
            )
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              colors={[appBrand.colors.primary]}
              tintColor={appBrand.colors.primary}
            />
          }
          contentContainerStyle={[
            styles.listContent,
            systemListData.length === 0 ? styles.listContentEmpty : null,
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  list: { flex: 1 },
  listContent: { paddingBottom: 24 },
  listContentEmpty: { flexGrow: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { paddingVertical: 28, paddingHorizontal: 8, alignItems: 'center' },
  emptyText: { fontSize: 14, color: '#6b7280', textAlign: 'center' },
  emptyHint: { fontSize: 13, color: '#9ca3af', textAlign: 'center', marginTop: 8 },
  myRidesBtn: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: appBrand.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 12,
  },
  myRidesBtnText: { color: appBrand.colors.primary, fontSize: 15, fontWeight: '700' },
  tabRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  tabBtnActive: {
    borderColor: appBrand.colors.primary,
    backgroundColor: appBrand.colors.greenLight,
  },
  tabBtnText: { fontSize: 12, fontWeight: '700', color: '#6b7280', textAlign: 'center' },
  tabBtnTextActive: { color: appBrand.colors.primary },
  intro: { fontSize: 14, color: '#6b7280', marginBottom: 12 },
  apiError: { fontSize: 13, color: '#b91c1c', marginBottom: 8 },
  systemSectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f766e',
    marginBottom: 12,
  },
  systemSubtabRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  systemSubtabBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  systemSubtabBtnActive: { borderColor: '#0f766e', backgroundColor: '#ecfeff' },
  systemSubtabBtnText: { fontSize: 12, fontWeight: '700', color: '#6b7280' },
  systemSubtabBtnTextActive: { color: '#0f766e' },
  systemEmptyWrap: { paddingVertical: 8, paddingHorizontal: 4 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  origin: { fontSize: 15, fontWeight: '600', color: '#111' },
  destination: { fontSize: 14, color: '#6b7280', marginTop: 2 },
  meta: { fontSize: 13, color: '#6b7280', marginTop: 8 },
  hint: { fontSize: 12, color: '#9ca3af', marginTop: 4 },
  primaryBtn: {
    backgroundColor: appBrand.colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 12,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  longDistBtn: {
    backgroundColor: '#0f766e',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 12,
    alignItems: 'center',
  },
  longDistBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  kindBadgeRow: { marginBottom: 8 },
  kindBadge: {
    alignSelf: 'flex-start',
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  kindBadgeInternal: { backgroundColor: appBrand.colors.greenLight, color: appBrand.colors.primary },
  kindBadgeLong: { backgroundColor: '#ccfbf1', color: '#115e59' },
});
