/**
 * Buscar viajes publicados: fecha y hora desde obligatorias; origen/destino por texto y/o mapa; tipo de viaje.
 * Con `favoriteSlot` en la ruta: mismo formulario solo para guardar trayecto favorito (p. ej. Casa → Trabajo).
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Platform,
  Alert,
  Switch,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { searchRides } from '../rides/api';
import type { MainStackParamList } from '../navigation/types';
import {
  SearchOriginDestinationMap,
  type SearchRouteEtaState,
} from '../components/SearchOriginDestinationMap';
import type { Point } from '../lib/geo';
import {
  getPassengerFavorite,
  loadPassengerFavorites,
  upsertPassengerFavorite,
  favoritePairLabel,
  computeNextTriggerIso,
} from '../lib/passengerFavorites';
import { pushPassengerHomeMapShortcuts } from '../backend/passengerHomeMapShortcutSync';
import { useAuth } from '../auth/AuthContext';

type Nav = NativeStackNavigationProp<MainStackParamList, 'SearchPublishedRides'>;

function toYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatEstimatedArrivalLine(
  dateYmd: string,
  fromTimeHm: string,
  routeEta: SearchRouteEtaState,
  hasOriginDestPins: boolean
): { text: string; isPlaceholder: boolean } {
  if (!hasOriginDestPins) {
    return { text: 'Marcá origen y destino en el mapa', isPlaceholder: true };
  }
  if (!dateYmd.trim() || !fromTimeHm.trim()) {
    return { text: 'Completá fecha y hora desde para estimar la llegada', isPlaceholder: true };
  }
  if (routeEta.loading) {
    return { text: 'Calculando ruta…', isPlaceholder: true };
  }
  if (routeEta.durationMinutes == null) {
    return { text: 'No disponible (sin duración del trayecto)', isPlaceholder: true };
  }
  const [yy, mm, dd] = dateYmd.trim().split('-').map((x) => parseInt(x, 10));
  const [h, mi] = fromTimeHm.trim().split(':').map((x) => parseInt(x, 10));
  if (![yy, mm, dd, h, mi].every((n) => Number.isFinite(n))) {
    return { text: 'Fecha u hora no válida', isPlaceholder: true };
  }
  const dep = new Date(yy, mm - 1, dd, h, mi, 0, 0);
  const arr = new Date(dep.getTime() + routeEta.durationMinutes * 60_000);
  const hm = arr.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' });
  const mins = Math.round(routeEta.durationMinutes);
  return {
    text: `~${hm} en destino (${mins} min según la ruta del mapa)`,
    isPlaceholder: false,
  };
}

function applyRideKindFilter(
  rows: Record<string, unknown>[],
  rideKind: 'all' | 'internal' | 'long_distance'
) {
  if (rideKind === 'all') return rows;
  return rows.filter((r) => {
    const hasDriverSeatPrice = Number(r.price_per_seat ?? 0) > 0;
    return rideKind === 'long_distance' ? hasDriverSeatPrice : !hasDriverSeatPrice;
  });
}

/** Radio en mapa según tipo: internos = pocos km; larga distancia = corredor amplio. */
function mapSearchRadiusKmForRideKind(rideKind: 'all' | 'internal' | 'long_distance'): number {
  if (rideKind === 'internal') return 1;
  if (rideKind === 'long_distance') return 50;
  return 10;
}

type BuscoFromSearchPayload = {
  originLabel: string;
  destinationLabel: string;
  originLat?: number;
  originLng?: number;
  destinationLat?: number;
  destinationLng?: number;
  requestedDate: string;
  requestedTime: string;
};

function SearchEmptyResults({
  navigation,
  activeFilterLabels,
  buscoFromSearch,
  searchRideKind,
}: {
  navigation: Nav;
  activeFilterLabels: string[];
  buscoFromSearch: BuscoFromSearchPayload;
  searchRideKind: 'all' | 'internal' | 'long_distance';
}) {
  const goSaveTripRequest = () => {
    const suggestedPricingKind =
      searchRideKind === 'internal' || searchRideKind === 'long_distance' ? searchRideKind : undefined;
    navigation.navigate('SaveTripRequest', {
      originLabel: buscoFromSearch.originLabel || undefined,
      destinationLabel: buscoFromSearch.destinationLabel || undefined,
      originLat: buscoFromSearch.originLat,
      originLng: buscoFromSearch.originLng,
      destinationLat: buscoFromSearch.destinationLat,
      destinationLng: buscoFromSearch.destinationLng,
      requestedDate: buscoFromSearch.requestedDate.trim(),
      requestedTime: buscoFromSearch.requestedTime.trim() || '08:00',
      suggestedPricingKind,
    });
  };

  return (
    <View style={styles.emptyBlock}>
      <Text style={styles.emptyTitle}>No se encontraron viajes</Text>
      <Text style={styles.emptyLead}>
        Guardá tu solicitud de trayecto para que los conductores la vean y puedan publicar un viaje para vos.
      </Text>

      <View style={styles.emptySection}>
        <Text style={styles.emptySectionTitle}>Otras opciones</Text>
        <TouchableOpacity
          style={styles.emptyPrimaryBtn}
          onPress={goSaveTripRequest}
          accessibilityRole="button"
          accessibilityLabel="Guardar solicitud de trayecto con datos de la búsqueda"
        >
          <Text style={styles.emptyPrimaryBtnText}>Guardar solicitud de trayecto (datos de arriba)</Text>
        </TouchableOpacity>
        <Text style={styles.emptyMuted}>
          Vas a confirmar si el trayecto es interno (ya cotizado) o larga distancia (precio que querés pagar por
          asiento). Si falta origen o destino en el mapa, completalo en el formulario.
        </Text>
        <TouchableOpacity
          style={styles.emptyLinkBtn}
          onPress={() => navigation.navigate('AvailableRides')}
          accessibilityRole="button"
        >
          <Text style={styles.emptyLinkBtnText}>Ver viajes disponibles (lista del día)</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.emptyLinkBtn}
          onPress={() => navigation.navigate('PassengerDemandRoutes')}
          accessibilityRole="button"
        >
          <Text style={styles.emptyLinkBtnText}>Rutas con demanda (unirme a un grupo)</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.emptyLinkBtnOutline}
          onPress={() => navigation.navigate('MyTripRequests')}
          accessibilityRole="button"
        >
          <Text style={styles.emptyLinkBtnOutlineText}>Ver mis solicitudes guardadas</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function SearchPublishedRidesScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<MainStackParamList, 'SearchPublishedRides'>>();
  const favoriteSlot = route.params?.favoriteSlot;
  const isFavoriteMode = favoriteSlot != null;
  const { session } = useAuth();
  const userId = session?.id ?? '';

  const [date, setDate] = useState(() => toYmdLocal(new Date()));
  /** HH:MM (24 h), obligatoria junto con la fecha. */
  const [fromTime, setFromTime] = useState('08:00');
  const [routeNameQuery, setRouteNameQuery] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [originGeo, setOriginGeo] = useState<Point | null>(null);
  const [destGeo, setDestGeo] = useState<Point | null>(null);
  const [rideKind, setRideKind] = useState<'all' | 'internal' | 'long_distance'>('all');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [scheduleDaily, setScheduleDaily] = useState(false);
  const [loading, setLoading] = useState(!isFavoriteMode);
  const [list, setList] = useState<Record<string, unknown>[]>([]);
  const [routeEta, setRouteEta] = useState<SearchRouteEtaState>({
    loading: false,
    durationMinutes: null,
    distanceKm: null,
  });
  useLayoutEffect(() => {
    navigation.setOptions({
      title: favoriteSlot ? `Favorito: ${favoritePairLabel(favoriteSlot)}` : 'Buscar viajes',
    });
  }, [navigation, favoriteSlot]);

  useEffect(() => {
    if (!favoriteSlot || !userId) return;
    let cancelled = false;
    void (async () => {
      const snap = await getPassengerFavorite(userId, favoriteSlot);
      if (cancelled || !snap) return;
      setDate(snap.scheduledDateYmd?.trim() || snap.date);
      setFromTime(snap.scheduledTimeHm?.trim() || snap.fromTime);
      setRouteNameQuery(snap.routeNameQuery);
      setOrigin(snap.origin);
      setDestination(snap.destination);
      setOriginGeo(
        snap.originLat != null && snap.originLng != null ? { lat: snap.originLat, lng: snap.originLng } : null
      );
      setDestGeo(
        snap.destinationLat != null && snap.destinationLng != null
          ? { lat: snap.destinationLat, lng: snap.destinationLng }
          : null
      );
      setRideKind(snap.rideKind);
      setScheduleDaily(Boolean(snap.scheduleDaily));
    })();
    return () => {
      cancelled = true;
    };
  }, [favoriteSlot, userId]);

  const load = useCallback(async () => {
    setLoading(true);
    setList([]);
    try {
      const mapKm = mapSearchRadiusKmForRideKind(rideKind);
      const rows = (await searchRides({
        date: date.trim(),
        fromTimeLocal: fromTime.trim() || '08:00',
        routeName: routeNameQuery.trim() || undefined,
        origin: originGeo ? undefined : origin.trim() || undefined,
        destination: destGeo ? undefined : destination.trim() || undefined,
        originNear: originGeo
          ? { lat: originGeo.lat, lng: originGeo.lng, radiusKm: mapKm }
          : undefined,
        destinationNear: destGeo
          ? { lat: destGeo.lat, lng: destGeo.lng, radiusKm: mapKm }
          : undefined,
        seats: 1,
      })) as Record<string, unknown>[];
      setList(applyRideKindFilter(rows, rideKind));
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [date, fromTime, routeNameQuery, origin, destination, originGeo, destGeo, rideKind]);

  useEffect(() => {
    if (isFavoriteMode) return;
    void load();
  }, [load, isFavoriteMode]);

  const saveFavorite = useCallback(async () => {
    if (!favoriteSlot) return;
    if (!userId) {
      Alert.alert('Sesión', 'Iniciá sesión para guardar favoritos.');
      return;
    }
    if (!date.trim() || !fromTime.trim()) {
      Alert.alert('Datos incompletos', 'Elegí fecha y hora desde.');
      return;
    }
    const hasOrigin = origin.trim().length > 0 || originGeo != null;
    const hasDest = destination.trim().length > 0 || destGeo != null;
    if (!hasOrigin || !hasDest) {
      Alert.alert('Datos incompletos', 'Indicá origen y destino (texto o mapa).');
      return;
    }
    try {
      await upsertPassengerFavorite(userId, favoriteSlot, {
        date: date.trim(),
        fromTime: fromTime.trim() || '08:00',
        routeNameQuery: routeNameQuery.trim(),
        origin: origin.trim(),
        destination: destination.trim(),
        originLat: originGeo?.lat ?? null,
        originLng: originGeo?.lng ?? null,
        destinationLat: destGeo?.lat ?? null,
        destinationLng: destGeo?.lng ?? null,
        rideKind,
        enabled: true,
        scheduleDaily,
        scheduledDateYmd: date.trim(),
        scheduledTimeHm: fromTime.trim() || '08:00',
        nextTriggerAtIso:
          computeNextTriggerIso(new Date(), date.trim(), fromTime.trim() || '08:00', scheduleDaily) ?? undefined,
      });
      const store = await loadPassengerFavorites(userId);
      void pushPassengerHomeMapShortcuts(store);
      Alert.alert(
        'Guardado',
        `Se guardó tu favorito «${favoritePairLabel(favoriteSlot)}» en este dispositivo.`,
        [
          {
            text: 'OK',
            onPress: () => navigation.navigate('MainTabs'),
          },
        ]
      );
    } catch {
      Alert.alert('Error', 'No se pudo guardar el favorito. Intentá de nuevo.');
    }
  }, [
    favoriteSlot,
    userId,
    date,
    fromTime,
    routeNameQuery,
    origin,
    destination,
    originGeo,
    destGeo,
    rideKind,
    scheduleDaily,
  ]);

  const buscoFromSearch = useMemo(
    () => ({
      originLabel: origin.trim(),
      destinationLabel: destination.trim(),
      originLat: originGeo?.lat,
      originLng: originGeo?.lng,
      destinationLat: destGeo?.lat,
      destinationLng: destGeo?.lng,
      requestedDate: date.trim(),
      requestedTime: fromTime.trim() || '08:00',
    }),
    [origin, destination, originGeo, destGeo, date, fromTime]
  );

  const estimatedArrival = useMemo(
    () =>
      formatEstimatedArrivalLine(date, fromTime, routeEta, Boolean(originGeo && destGeo)),
    [date, fromTime, routeEta, originGeo, destGeo]
  );

  const activeFilterLabels = useMemo(() => {
    const parts: string[] = [];
    parts.push(`Fecha: ${date.trim()}, desde ${fromTime.trim() || '08:00'}`);
    if (originGeo) {
      const km = mapSearchRadiusKmForRideKind(rideKind);
      parts.push(
        `Origen: mapa (~${km} km según tipo de viaje; origen del viaje o su ruta)`
      );
    }
    else if (origin.trim()) parts.push(`Origen: texto “${origin.trim().slice(0, 48)}${origin.trim().length > 48 ? '…' : ''}”`);
    if (destGeo) {
      const km = mapSearchRadiusKmForRideKind(rideKind);
      parts.push(`Destino: mapa (~${km} km según tipo de viaje; destino del viaje o su ruta)`);
    }
    else if (destination.trim()) {
      parts.push(
        `Destino: texto “${destination.trim().slice(0, 48)}${destination.trim().length > 48 ? '…' : ''}”`
      );
    }
    if (routeNameQuery.trim()) {
      parts.push(`Nombre del viaje: “${routeNameQuery.trim().slice(0, 48)}${routeNameQuery.trim().length > 48 ? '…' : ''}”`);
    }
    if (rideKind === 'internal') parts.push('Tipo: solo viajes internos');
    if (rideKind === 'long_distance') parts.push('Tipo: solo larga distancia');
    return parts;
  }, [date, fromTime, routeNameQuery, origin, destination, originGeo, destGeo, rideKind]);

  const listHeader = useMemo(
    () => (
    <View>
      <Text style={styles.label}>Fecha</Text>
      <TouchableOpacity
        style={styles.pickerRow}
        onPress={() => setShowDatePicker(true)}
        accessibilityRole="button"
        accessibilityLabel="Elegir fecha"
      >
        <Text style={styles.pickerValue}>{date.trim()}</Text>
      </TouchableOpacity>
      {showDatePicker ? (
        <DateTimePicker
          value={new Date(date.trim() + 'T12:00:00')}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(ev, d) => {
            if (ev.type === 'dismissed') {
              setShowDatePicker(false);
              return;
            }
            if (Platform.OS !== 'ios') setShowDatePicker(false);
            if (d) setDate(toYmdLocal(d));
          }}
        />
      ) : null}
      <Text style={styles.label}>Hora desde</Text>
      <TouchableOpacity
        style={styles.pickerRow}
        onPress={() => setShowTimePicker(true)}
        accessibilityRole="button"
        accessibilityLabel="Elegir hora desde"
      >
        <Text style={styles.pickerValue}>{fromTime.trim() || '08:00'}</Text>
      </TouchableOpacity>
      {showTimePicker ? (
        <DateTimePicker
          value={(() => {
            const [h, m] = fromTime.split(':').map((x) => parseInt(x, 10));
            const d = new Date();
            d.setHours(Number.isFinite(h) ? h : 8, Number.isFinite(m) ? m : 0, 0, 0);
            return d;
          })()}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(ev, d) => {
            if (ev.type === 'dismissed') {
              setShowTimePicker(false);
              return;
            }
            if (Platform.OS !== 'ios') setShowTimePicker(false);
            if (d) {
              setFromTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
            }
          }}
        />
      ) : null}
      {favoriteSlot ? (
        <View style={styles.dailyRow}>
          <View style={styles.dailyTextWrap}>
            <Text style={styles.dailyTitle}>Reprogramar diario</Text>
            <Text style={styles.dailyHint}>
              Si activás, se agenda todos los días a esta hora hasta apagar el switch en Inicio.
            </Text>
          </View>
          <Switch
            value={scheduleDaily}
            onValueChange={setScheduleDaily}
            trackColor={{ false: '#d1d5db', true: '#86efac' }}
            thumbColor={scheduleDaily ? '#166534' : '#f3f4f6'}
          />
        </View>
      ) : null}
      <Text style={styles.label}>Llegada estimada en destino</Text>
      <View
        style={[styles.pickerRow, styles.pickerRowReadOnly]}
        accessibilityRole="text"
        accessibilityLabel={`Llegada estimada: ${estimatedArrival.text}`}
      >
        <Text
          style={estimatedArrival.isPlaceholder ? styles.pickerPlaceholder : styles.pickerValue}
          selectable
        >
          {estimatedArrival.text}
        </Text>
      </View>
      <Text style={styles.etaHint}>
        El horario de llegada es estimado: puede variar según el tráfico, el recorrido real del viaje y otros
        pasajeros.
      </Text>
      <Text style={styles.label}>Nombre del viaje (opcional)</Text>
      <TextInput
        style={styles.input}
        value={routeNameQuery}
        onChangeText={setRouteNameQuery}
        placeholder="Si el conductor lo definió al publicar"
        placeholderTextColor="#9ca3af"
      />
      <Text style={styles.label}>Origen (texto)</Text>
      <TextInput
        style={styles.input}
        value={origin}
        onChangeText={(t) => {
          setOrigin(t);
          setOriginGeo(null);
        }}
        placeholder="Opcional — o marcá en el mapa abajo"
        placeholderTextColor="#9ca3af"
      />
      <Text style={styles.label}>Destino (texto)</Text>
      <TextInput
        style={styles.input}
        value={destination}
        onChangeText={(t) => {
          setDestination(t);
          setDestGeo(null);
        }}
        placeholder="Opcional — o marcá en el mapa abajo"
        placeholderTextColor="#9ca3af"
      />

      <SearchOriginDestinationMap
        origin={originGeo}
        destination={destGeo}
        onOriginChange={setOriginGeo}
        onDestinationChange={setDestGeo}
        onOriginLabelResolved={setOrigin}
        onDestinationLabelResolved={setDestination}
        onRouteEtaChange={setRouteEta}
        proximityRadiusKm={mapSearchRadiusKmForRideKind(rideKind)}
        height={240}
      />

      <Text style={styles.label}>Tipo de viaje</Text>
      <View style={styles.kindRow}>
        <TouchableOpacity
          style={[styles.kindChip, rideKind === 'all' && styles.kindChipActive]}
          onPress={() => setRideKind('all')}
          accessibilityRole="button"
        >
          <Text style={[styles.kindChipText, rideKind === 'all' && styles.kindChipTextActive]}>Todos</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.kindChip, rideKind === 'internal' && styles.kindChipActive]}
          onPress={() => setRideKind('internal')}
          accessibilityRole="button"
        >
          <Text style={[styles.kindChipText, rideKind === 'internal' && styles.kindChipTextActive]}>Interno</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.kindChip, rideKind === 'long_distance' && styles.kindChipActive]}
          onPress={() => setRideKind('long_distance')}
          accessibilityRole="button"
        >
          <Text style={[styles.kindChipText, rideKind === 'long_distance' && styles.kindChipTextActive]}>
            Larga distancia
          </Text>
        </TouchableOpacity>
      </View>

      {favoriteSlot ? (
        <TouchableOpacity style={styles.searchBtn} onPress={() => void saveFavorite()} accessibilityRole="button">
          <Text style={styles.searchBtnText}>Guardar {favoritePairLabel(favoriteSlot)}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.searchBtn} onPress={() => void load()} accessibilityRole="button">
          <Text style={styles.searchBtnText}>Buscar</Text>
        </TouchableOpacity>
      )}
    </View>
    ),
    [
      date,
      fromTime,
      routeNameQuery,
      origin,
      destination,
      originGeo,
      destGeo,
      rideKind,
      load,
      saveFavorite,
      favoriteSlot,
      showDatePicker,
      showTimePicker,
      scheduleDaily,
      estimatedArrival,
    ]
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={list}
        keyExtractor={(item) => String(item.id)}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={styles.listSpinner} size="large" color="#166534" />
          ) : favoriteSlot ? null : (
            <SearchEmptyResults
              navigation={navigation}
              activeFilterLabels={activeFilterLabels}
              buscoFromSearch={buscoFromSearch}
              searchRideKind={rideKind}
            />
          )
        }
        renderItem={({ item }) => {
          const dep = item.departure_time ? new Date(String(item.departure_time)).toLocaleString('es-PY') : '';
          const rName = String((item as { route_name?: string | null }).route_name ?? '').trim();
          return (
            <TouchableOpacity
              style={styles.card}
              onPress={() => navigation.navigate('RideDetail', { rideId: String(item.id) })}
              accessibilityRole="button"
            >
              {rName ? (
                <Text style={styles.cardRouteName} numberOfLines={1}>
                  {rName}
                </Text>
              ) : null}
              <Text style={styles.cardTitle} numberOfLines={2}>
                {String(item.origin_label ?? '')} → {String(item.destination_label ?? '')}
              </Text>
              <Text style={styles.cardMeta}>{dep}</Text>
              <Text style={styles.cardMeta}>Cupos: {String(item.available_seats ?? '—')}</Text>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  listContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32 },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 4 },
  pickerRow: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 10,
    backgroundColor: '#fff',
  },
  pickerRowReadOnly: {
    backgroundColor: '#f9fafb',
  },
  dailyRow: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dailyTextWrap: { flex: 1 },
  dailyTitle: { fontSize: 14, fontWeight: '700', color: '#14532d' },
  dailyHint: { fontSize: 12, color: '#6b7280', lineHeight: 17, marginTop: 2 },
  etaHint: {
    fontSize: 12,
    color: '#9ca3af',
    lineHeight: 17,
    marginBottom: 10,
    marginTop: -4,
  },
  pickerValue: { fontSize: 16, color: '#111' },
  pickerPlaceholder: { fontSize: 16, color: '#9ca3af' },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    fontSize: 16,
  },
  clearLink: { fontSize: 13, color: '#166534', fontWeight: '600', marginBottom: 10 },
  kindRow: { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  kindChip: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
  },
  kindChipActive: {
    borderColor: '#166534',
    backgroundColor: '#166534',
  },
  kindChipText: { fontSize: 13, color: '#374151', fontWeight: '600' },
  kindChipTextActive: { color: '#fff' },
  searchBtn: {
    backgroundColor: '#166534',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 8,
  },
  searchBtnText: { color: '#fff', fontWeight: '700' },
  listSpinner: { marginTop: 28 },
  card: {
    backgroundColor: '#f9fafb',
    padding: 14,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  cardRouteName: { fontSize: 14, fontWeight: '700', color: '#14532d', marginBottom: 4 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#111' },
  cardMeta: { fontSize: 13, color: '#6b7280', marginTop: 4 },
  emptyBlock: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111',
    textAlign: 'center',
    marginBottom: 10,
  },
  emptyLead: {
    fontSize: 14,
    color: '#4b5563',
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 16,
  },
  emptySection: { marginBottom: 18 },
  emptySectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  emptyBullet: {
    fontSize: 14,
    color: '#4b5563',
    lineHeight: 22,
    marginBottom: 4,
    paddingLeft: 2,
  },
  emptyMuted: {
    fontSize: 12,
    color: '#9ca3af',
    lineHeight: 17,
    marginTop: 8,
  },
  emptyLinkBtn: {
    borderWidth: 1,
    borderColor: '#166534',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
    backgroundColor: '#fff',
  },
  emptyLinkBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#166534',
    textAlign: 'center',
  },
  emptyPrimaryBtn: {
    backgroundColor: '#166534',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  emptyPrimaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
  },
  emptyLinkBtnOutline: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 4,
    backgroundColor: '#fff',
  },
  emptyLinkBtnOutlineText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4b5563',
    textAlign: 'center',
  },
});
