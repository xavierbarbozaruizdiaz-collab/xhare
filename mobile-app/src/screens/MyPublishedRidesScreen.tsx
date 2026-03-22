/**
 * Conductor: viajes propios agrupados en Programados / No realizados / Realizados.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { fetchMyRides, fetchBookingsAggregate } from '../rides/api';
import type { MainStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<MainStackParamList, 'MyPublishedRides'>;

type RideRow = Record<string, unknown> & { id: string; reserved?: number };

type Bucket = 'programados' | 'noRealizados' | 'realizados';

function classifyRide(r: Record<string, unknown>, now: number): Bucket {
  const st = String(r.status ?? '');
  if (st === 'completed') return 'realizados';
  if (st === 'cancelled') return 'noRealizados';
  /** Siempre en Programados: si cae por tiempo en "no realizados" el conductor no lo encuentra para finalizar. */
  if (st === 'en_route') return 'programados';

  const depIso = r.departure_time as string | undefined;
  const depMs = depIso ? new Date(depIso).getTime() : NaN;
  if (Number.isNaN(depMs)) return 'programados';

  const durMin = Math.max(1, Number(r.estimated_duration_minutes ?? 60));
  const endMs = depMs + durMin * 60 * 1000;

  if (endMs < now) return 'noRealizados';
  return 'programados';
}

function formatDeparture(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-PY', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusLabel(s: string | null | undefined): string {
  switch (s) {
    case 'published':
      return 'Publicado';
    case 'booked':
      return 'Con reservas';
    case 'en_route':
      return 'En ruta';
    case 'draft':
      return 'Borrador';
    case 'completed':
      return 'Finalizado';
    case 'cancelled':
      return 'Cancelado';
    default:
      return s ?? '—';
  }
}

function RideCard({
  r,
  onPress,
}: {
  r: RideRow;
  onPress: () => void;
}) {
  const origin = String(r.origin_label ?? 'Origen');
  const dest = String(r.destination_label ?? 'Destino');
  const seats = Number(r.available_seats ?? r.total_seats ?? 0);
  const reserved = Number(r.reserved ?? 0);
  const enRoute = String(r.status) === 'en_route';
  return (
    <TouchableOpacity
      style={[styles.card, enRoute && styles.cardEnRoute]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Viaje ${origin} a ${dest}`}
    >
      <Text style={[styles.when, enRoute && styles.whenEnRoute]}>
        {enRoute ? 'En curso · ' : ''}
        {formatDeparture(r.departure_time as string)}
      </Text>
      <Text style={styles.route} numberOfLines={2}>
        {origin} → {dest}
      </Text>
      <Text style={styles.meta}>
        {statusLabel(r.status as string)}
        {reserved > 0 ? ` · ${reserved} asiento(s) reservados` : ''}
        {seats > 0 ? ` · ${seats} libres` : ''}
      </Text>
    </TouchableOpacity>
  );
}

export function MyPublishedRidesScreen() {
  const navigation = useNavigation<Nav>();
  const { session } = useAuth();

  const [rows, setRows] = useState<RideRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.id) {
      setLoading(false);
      setRows([]);
      return;
    }
    setError(null);
    try {
      const list = await fetchMyRides(session.id);
      const all = list as RideRow[];
      const ids = all.map((r) => r.id);
      const { reservedByRide } = await fetchBookingsAggregate(ids);
      setRows(
        all.map((r) => ({
          ...r,
          reserved: reservedByRide[r.id] ?? 0,
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar tus viajes');
      setRows([]);
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

  const buckets = useMemo(() => {
    const now = Date.now();
    const programados: RideRow[] = [];
    const noRealizados: RideRow[] = [];
    const realizados: RideRow[] = [];

    for (const r of rows) {
      const b = classifyRide(r, now);
      if (b === 'realizados') realizados.push(r);
      else if (b === 'noRealizados') noRealizados.push(r);
      else programados.push(r);
    }

    const depAsc = (a: RideRow, b: RideRow) => {
      const ta = new Date((a.departure_time as string) ?? 0).getTime();
      const tb = new Date((b.departure_time as string) ?? 0).getTime();
      return ta - tb;
    };
    const depDesc = (a: RideRow, b: RideRow) => -depAsc(a, b);

    programados.sort((a, b) => {
      const ae = String(a.status) === 'en_route' ? 0 : 1;
      const be = String(b.status) === 'en_route' ? 0 : 1;
      if (ae !== be) return ae - be;
      return depAsc(a, b);
    });
    noRealizados.sort(depDesc);
    realizados.sort(depDesc);

    return { programados, noRealizados, realizados };
  }, [rows]);

  const enRouteRide = useMemo(
    () => rows.find((r) => String(r.status) === 'en_route') ?? null,
    [rows]
  );

  const [openBucket, setOpenBucket] = useState<Bucket | null>(null);

  useEffect(() => {
    if (openBucket == null) return;
    const len =
      openBucket === 'programados'
        ? buckets.programados.length
        : openBucket === 'noRealizados'
          ? buckets.noRealizados.length
          : buckets.realizados.length;
    if (len === 0) setOpenBucket(null);
  }, [openBucket, buckets]);

  const bucketOrder: Bucket[] = ['programados', 'noRealizados', 'realizados'];
  const bucketLabels: Record<Bucket, { title: string; subtitle: string }> = {
    programados: {
      title: 'Programados',
      subtitle:
        'Próximas salidas, viaje en ruta (En ruta) y publicados dentro del horario estimado. El viaje en curso aparece primero en la lista.',
    },
    noRealizados: {
      title: 'No realizados',
      subtitle: 'Cancelados o la fecha del viaje ya pasó y no está finalizado.',
    },
    realizados: {
      title: 'Realizados',
      subtitle: 'Viajes marcados como finalizados.',
    },
  };

  const toggleBucket = useCallback((b: Bucket) => {
    const len =
      b === 'programados'
        ? buckets.programados.length
        : b === 'noRealizados'
          ? buckets.noRealizados.length
          : buckets.realizados.length;
    if (len === 0) return;
    setOpenBucket((cur) => (cur === b ? null : b));
  }, [buckets]);

  if (loading && rows.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  const hasAnyRide =
    buckets.programados.length + buckets.noRealizados.length + buckets.realizados.length > 0;

  const listData =
    openBucket === 'programados'
      ? buckets.programados
      : openBucket === 'noRealizados'
        ? buckets.noRealizados
        : openBucket === 'realizados'
          ? buckets.realizados
          : [];

  return (
    <View style={styles.container}>
      <Text style={styles.intro}>
        Elegí una categoría para ver la lista. En cada viaje podés abrir detalle, pasajeros y acciones.
      </Text>
      {enRouteRide ? (
        <TouchableOpacity
          style={styles.enRouteBanner}
          onPress={() => navigation.navigate('RideDetail', { rideId: enRouteRide.id })}
          accessibilityRole="button"
          accessibilityLabel="Abrir viaje en curso"
        >
          <Text style={styles.enRouteBannerTitle}>Viaje en curso</Text>
          <Text style={styles.enRouteBannerSub} numberOfLines={2}>
            {String(enRouteRide.origin_label ?? 'Origen').slice(0, 42)}
            {' → '}
            {String(enRouteRide.destination_label ?? 'Destino').slice(0, 42)}
          </Text>
          <Text style={styles.enRouteBannerHint}>Tocá para ver detalle y finalizar el viaje</Text>
        </TouchableOpacity>
      ) : null}
      {error ? <Text style={styles.err}>{error}</Text> : null}

      {!hasAnyRide ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Todavía no tenés viajes registrados.</Text>
          <TouchableOpacity style={styles.linkBtn} onPress={() => navigation.navigate('PublishRide', {})}>
            <Text style={styles.linkBtnText}>Publicar un viaje</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={styles.bucketList}>
            {bucketOrder.map((b) => {
              const count =
                b === 'programados'
                  ? buckets.programados.length
                  : b === 'noRealizados'
                    ? buckets.noRealizados.length
                    : buckets.realizados.length;
              const active = openBucket === b;
              const empty = count === 0;
              return (
                <TouchableOpacity
                  key={b}
                  style={[styles.bucketBtn, active && styles.bucketBtnActive, empty && styles.bucketBtnDisabled]}
                  onPress={() => toggleBucket(b)}
                  disabled={empty}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active, disabled: empty }}
                  accessibilityLabel={`${bucketLabels[b].title}, ${count} viajes`}
                >
                  <View style={styles.bucketBtnTextWrap}>
                    <Text style={[styles.bucketBtnTitle, empty && styles.bucketBtnTitleDisabled]}>
                      {bucketLabels[b].title}
                    </Text>
                    <Text style={[styles.bucketBtnHint, empty && styles.bucketBtnHintDisabled]}>
                      {empty ? 'Sin viajes' : active ? 'Tocá de nuevo para ocultar' : 'Ver lista'}
                    </Text>
                  </View>
                  <Text style={[styles.bucketCount, empty && styles.bucketCountDisabled]}>{count}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {openBucket == null ? (
            <View style={styles.listPlaceholder}>
              <Text style={styles.listPlaceholderText}>
                Tocá Programados, No realizados o Realizados para mostrar los viajes de esa categoría.
                {enRouteRide
                  ? ' El viaje en curso está en Programados (primero de la lista) o tocá el recuadro azul arriba.'
                  : ''}
              </Text>
            </View>
          ) : (
            <FlatList
              style={styles.listFlex}
              data={listData}
              keyExtractor={(item) => item.id}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
              contentContainerStyle={styles.listPad}
              ListHeaderComponent={
                <View style={styles.listSectionIntro}>
                  <Text style={styles.sectionSubtitle}>{bucketLabels[openBucket].subtitle}</Text>
                </View>
              }
              renderItem={({ item }) => (
                <RideCard r={item} onPress={() => navigation.navigate('RideDetail', { rideId: item.id })} />
              )}
            />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  intro: { fontSize: 14, color: '#6b7280', marginBottom: 12, lineHeight: 20 },
  enRouteBanner: {
    backgroundColor: '#eff6ff',
    borderWidth: 2,
    borderColor: '#2563eb',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  enRouteBannerTitle: { fontSize: 15, fontWeight: '800', color: '#1d4ed8' },
  enRouteBannerSub: { fontSize: 13, color: '#1e3a8a', marginTop: 6, lineHeight: 18 },
  enRouteBannerHint: { fontSize: 12, color: '#3b82f6', marginTop: 8, fontWeight: '600' },
  err: { fontSize: 13, color: '#b91c1c', marginBottom: 8 },
  bucketList: { gap: 10, marginBottom: 12 },
  bucketBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  bucketBtnActive: {
    borderColor: '#166534',
    backgroundColor: '#f0fdf4',
  },
  bucketBtnDisabled: { opacity: 0.55 },
  bucketBtnTextWrap: { flex: 1, paddingRight: 12 },
  bucketBtnTitle: { fontSize: 16, fontWeight: '700', color: '#14532d' },
  bucketBtnTitleDisabled: { color: '#9ca3af' },
  bucketBtnHint: { fontSize: 12, color: '#6b7280', marginTop: 4 },
  bucketBtnHintDisabled: { color: '#9ca3af' },
  bucketCount: { fontSize: 18, fontWeight: '700', color: '#166534', minWidth: 28, textAlign: 'right' },
  bucketCountDisabled: { color: '#9ca3af' },
  listFlex: { flex: 1 },
  listPad: { paddingBottom: 32 },
  listPlaceholder: { flex: 1, justifyContent: 'center', paddingHorizontal: 8, paddingBottom: 24 },
  listPlaceholderText: { fontSize: 14, color: '#9ca3af', textAlign: 'center', lineHeight: 20 },
  listSectionIntro: { marginBottom: 12 },
  sectionSubtitle: { fontSize: 12, color: '#6b7280', lineHeight: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  cardEnRoute: {
    borderColor: '#2563eb',
    borderWidth: 2,
    backgroundColor: '#f8fafc',
  },
  when: { fontSize: 13, fontWeight: '600', color: '#166534', marginBottom: 6 },
  whenEnRoute: { color: '#1d4ed8' },
  route: { fontSize: 15, fontWeight: '600', color: '#111' },
  meta: { fontSize: 13, color: '#6b7280', marginTop: 8 },
  empty: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { fontSize: 16, color: '#6b7280', textAlign: 'center', marginBottom: 16 },
  linkBtn: { backgroundColor: '#166534', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8 },
  linkBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
