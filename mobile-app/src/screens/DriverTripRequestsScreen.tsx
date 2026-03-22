/**
 * Conductor: rutas con demanda agrupadas (grupos de pasajeros por ruta).
 * Lista desde GET /api/demand-routes; al refrescar llama sync y recarga. Tap → detalle con mapa → Publicar viaje.
 * Si la API no está configurada o no hay grupos, muestra solicitudes sueltas desde Supabase como fallback.
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
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../backend/supabase';
import { fetchDemandRoutes, syncDemandRoutes, type DemandRouteGroup } from '../backend/demandRoutesApi';
import { raceWithTimeout } from '../backend/withTimeout';
import { env } from '../core/env';
import type { MainStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<MainStackParamList, 'DriverTripRequests'>;

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

export function DriverTripRequestsScreen() {
  const navigation = useNavigation<Nav>();
  const { session } = useAuth();
  const [groups, setGroups] = useState<DemandRouteGroup[]>([]);
  const [fallbackRequests, setFallbackRequests] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [useApi, setUseApi] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const trace = (...args: unknown[]) => {
      if (__DEV__) console.log('[DriverTripRequests]', ...args);
    };
    trace('load:start', { hasSessionId: Boolean(session?.id), useApi, hasApiBase: Boolean(env.apiBaseUrl?.trim()) });

    if (!session?.id) {
      trace('load:abort no session.id');
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    setApiError(null);

    try {
      if (env.apiBaseUrl?.trim() && useApi) {
        trace('load:fetchDemandRoutes start');
        const { groups: g, error } = await fetchDemandRoutes({ requested_date_from: today });
        trace('load:fetchDemandRoutes done', { err: error ?? null, count: g?.length ?? 0 });
        if (error) {
          setApiError(error);
          setGroups([]);
        } else {
          setGroups(g ?? []);
        }
      } else {
        setGroups([]);
      }

      trace('load:supabase trip_requests start');
      const sbQuery = supabase
        .from('trip_requests')
        .select('id, origin_label, destination_label, requested_date, requested_time, seats, created_at')
        .eq('status', 'pending')
        .gte('requested_date', today)
        .order('requested_date', { ascending: true })
        .order('created_at', { ascending: false })
        .limit(200);
      const { data, error: sbError } = await raceWithTimeout(
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
      );
      trace('load:supabase trip_requests done', { err: sbError?.message ?? null, rows: data?.length ?? 0 });
      if (!sbError) setFallbackRequests(data ?? []);
      else {
        setFallbackRequests([]);
        setApiError((prev) => prev ?? sbError.message);
      }
    } catch (e) {
      trace('load:catch', e);
      setApiError(e instanceof Error ? e.message : 'Error al cargar la pantalla Conductor');
      setGroups([]);
      setFallbackRequests([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
      trace('load:finally');
    }
  }, [session?.id, useApi]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (env.apiBaseUrl?.trim()) {
      await syncDemandRoutes();
    }
    await load();
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);

  const parentNav = navigation.getParent() as { navigate: (a: string, b?: object) => void } | undefined;

  const hasApi = Boolean(env.apiBaseUrl?.trim());
  const showGroups = hasApi && groups.length > 0;
  const list = showGroups ? groups : fallbackRequests;
  const isGroupItem = showGroups;

  const renderItem = ({ item }: { item: DemandRouteGroup | Record<string, unknown> }) => {
    if (isGroupItem) {
      const g = item as DemandRouteGroup;
      return (
        <TouchableOpacity
          style={styles.card}
          onPress={() => parentNav?.navigate('DriverRouteGroupDetail', { groupId: g.id })}
          accessibilityLabel={`Ruta ${g.origin_city ?? 'Origen'} a ${g.destination_city ?? 'Destino'}, ${g.passenger_count} pasajeros`}
          accessibilityRole="button"
        >
          <Text style={styles.origin} numberOfLines={1}>
            {g.origin_city ?? 'Origen'} → {g.destination_city ?? 'Destino'}
          </Text>
          <Text style={styles.meta}>
            {formatDate(g.requested_date)} · {formatTime(g.requested_time)} · {g.passenger_count} pasajero(s)
          </Text>
          <Text style={styles.hint}>Tocá para ver mapa y publicar viaje</Text>
        </TouchableOpacity>
      );
    }
    const r = item as Record<string, unknown>;
    return (
      <View style={styles.card}>
        <Text style={styles.origin} numberOfLines={1}>{shortLabel(r.origin_label as string)}</Text>
        <Text style={styles.destination} numberOfLines={1}>→ {shortLabel(r.destination_label as string)}</Text>
        <Text style={styles.meta}>
          {formatDate(r.requested_date as string)} · {formatTime(r.requested_time as string)} · {Number(r.seats ?? 1)} asiento(s)
        </Text>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => parentNav?.navigate('PublishRide', { tripRequestId: r.id as string })}
          accessibilityLabel="Publicar viaje para esta solicitud"
          accessibilityRole="button"
        >
          <Text style={styles.primaryBtnText}>Publicar viaje para esta</Text>
        </TouchableOpacity>
      </View>
    );
  };

  if (loading && list.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.intro}>
        {showGroups
          ? 'Rutas con demanda agrupadas. Actualizá para recalcular grupos; tocá una ruta para ver el mapa y publicar un viaje.'
          : 'Solicitudes de pasajeros que no encontraron viajes. Creá un viaje para una solicitud y se vinculará automáticamente.'}
      </Text>
      {apiError && (
        <Text style={styles.apiError}>{apiError}</Text>
      )}
      {list.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {showGroups ? 'No hay rutas con demanda.' : 'No hay solicitudes pendientes.'}
          </Text>
          <TouchableOpacity style={styles.publishLink} onPress={() => parentNav?.navigate('PublishRide', {})}>
            <Text style={styles.publishLinkText}>Publicar un viaje</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(item) => String((item as DemandRouteGroup).id ?? (item as Record<string, unknown>).id)}
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
  destination: { fontSize: 14, color: '#6b7280', marginTop: 2 },
  meta: { fontSize: 13, color: '#6b7280', marginTop: 8 },
  hint: { fontSize: 12, color: '#9ca3af', marginTop: 4 },
  primaryBtn: {
    backgroundColor: '#166534',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 12,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  empty: { alignItems: 'center', paddingVertical: 32 },
  emptyText: { fontSize: 16, color: '#6b7280', marginBottom: 16 },
  publishLink: { backgroundColor: '#166534', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8 },
  publishLinkText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
