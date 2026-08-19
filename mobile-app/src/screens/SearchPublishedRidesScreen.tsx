/**
 * Buscar viajes publicados: mapa, filtros opcionales, tipo de viaje; acción principal Buscar.
 * Crear solicitud (trip_request) se ofrece cuando no hay resultados o al final de la lista si hace falta.
 * Con `favoriteSlot`: flujo favorito (guardar trayecto).
 */
import { appBrand } from '../ui/theme/brand';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { clampDateNotBeforeLocalDay, datePickerDisplay, startOfLocalDay, timePickerDisplay } from '../lib/datePickerUi';
import type { MainStackParamList } from '../navigation/types';
import {
  SearchOriginDestinationMap,
  type SearchRouteEtaState,
} from '../components/SearchOriginDestinationMap';
import {
  addMinutesToHm,
  formatEstimatedPickupLine,
  subtractMinutesFromHm,
} from '../lib/routeEtaFormat';
import type { Point } from '../lib/geo';
import {
  getPassengerFavorite,
  loadPassengerFavorites,
  upsertPassengerFavorite,
  favoritePairLabel,
  computeNextTriggerIso,
  coerceScheduleWeekdayMask,
  SCHEDULE_WEEKDAY_MASK_ALL,
} from '../lib/passengerFavorites';
import { pushPassengerHomeMapShortcuts } from '../backend/passengerHomeMapShortcutSync';
import { useAuth } from '../auth/AuthContext';
import { isPickupAtLeastLeadAhead, MIN_BOOKING_LEAD_MS } from '../lib/bookingLead';
import { Ionicons } from '@expo/vector-icons';

type Nav = NativeStackNavigationProp<MainStackParamList, 'SearchPublishedRides'>;

const WEEKDAY_TOGGLE_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const;
const SEARCH_RESULTS_INITIAL_LIMIT = 10;

const PRIMARY = appBrand.colors.primary;
const PAGE_BG = '#f7f8fa';

function toYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

function normalizeShareCodeInput(raw: string): string {
  const text = String(raw ?? '').toUpperCase().trim();
  if (!text) return '';
  const m = text.match(/XH-?[A-Z0-9]{6}/);
  if (!m) return '';
  const compact = m[0].replace('-', '');
  return `XH-${compact.slice(2)}`;
}

function startOfDayLocal(d: Date): Date {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Primera parte del label (ej. ciudad) + resto como detalle. */
function splitPlaceLabel(raw: string): { main: string; detail: string } {
  const s = String(raw ?? '').trim();
  if (!s) return { main: '—', detail: '' };
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
  const mainRaw = parts[0] ?? s;
  const main = mainRaw.length > 38 ? `${mainRaw.slice(0, 36)}…` : mainRaw;
  if (parts.length <= 1) return { main, detail: '' };
  const joined = parts.slice(1).join(', ');
  const detail = joined.length > 130 ? `${joined.slice(0, 128)}…` : joined;
  return { main, detail };
}

function relativeDayLineEs(dep: Date, now: Date): string {
  const d0 = startOfDayLocal(dep);
  const n0 = startOfDayLocal(now);
  const diffDays = Math.round((d0.getTime() - n0.getTime()) / 86400000);
  if (diffDays === 0) return 'Hoy';
  if (diffDays === 1) return 'Mañana';
  if (diffDays < 0) return 'Fecha pasada';
  const mon = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][dep.getMonth()] ?? '';
  const wd = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][dep.getDay()] ?? '';
  return `${wd}, ${dep.getDate()} ${mon}`;
}

function formatDepartureHmEs(dep: Date): string {
  try {
    return dep.toLocaleTimeString('es-PY', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch {
    return '—';
  }
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
  onCreateTripRequest,
}: {
  onCreateTripRequest: () => void;
}) {
  return (
    <View style={styles.emptyBlock}>
      <Text style={styles.emptyTitle}>No se encontraron viajes</Text>
      <Text style={styles.emptyLead}>
        Probá cambiar fecha, hora o filtros. Si no hay viajes publicados para lo que necesitás, podés crear una
        solicitud: los conductores la ven y pueden publicar un viaje para vos.
      </Text>
      <TouchableOpacity
        style={styles.emptyPrimaryBtn}
        onPress={onCreateTripRequest}
        accessibilityRole="button"
        accessibilityLabel="Crear viaje con los datos de la búsqueda"
      >
        <Text style={styles.emptyPrimaryBtnText}>Crear viaje con estos datos</Text>
      </TouchableOpacity>
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

  const [date, setDate] = useState('');
  /** HH:MM (24 h): en favoritos = salida/recogida (persistido); en búsqueda = hora desde. */
  const [fromTime, setFromTime] = useState('');
  /** Solo favoritos: hora a la que el usuario necesita llegar al destino (entrada principal). */
  const [arrivalTimeHm, setArrivalTimeHm] = useState('');
  const arrivalSyncedFromStoredPickupRef = useRef(false);
  const [shareCodeQuery, setShareCodeQuery] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [originGeo, setOriginGeo] = useState<Point | null>(null);
  const [destGeo, setDestGeo] = useState<Point | null>(null);
  const [rideKind, setRideKind] = useState<'all' | 'internal' | 'long_distance'>('all');
  /** Solo modo favorito: mapa plegable (ruta para hora llegada ↔ salida). En búsqueda normal el mapa está en Crear viaje. */
  const [favoriteMapExpanded, setFavoriteMapExpanded] = useState(true);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [advancedFiltersExpanded, setAdvancedFiltersExpanded] = useState(false);
  const [scheduleDaily, setScheduleDaily] = useState(false);
  /** Bits 0=domingo … 6=sábado (`Date.getDay`). Solo con `scheduleDaily`. */
  const [scheduleWeekdayMask, setScheduleWeekdayMask] = useState(SCHEDULE_WEEKDAY_MASK_ALL);
  /** Evita doble toque mientras corre el guardado (favorito + solicitud pending tardan en red). */
  const [savingFavorite, setSavingFavorite] = useState(false);
  const saveFavoriteInFlightRef = useRef(false);
  const [loading, setLoading] = useState(!isFavoriteMode);
  /** Búsqueda: fecha/hora “desde” demasiado pronto (< 4 h), solo cuando ambos filtros están completos. */
  const [searchLeadError, setSearchLeadError] = useState<string | null>(null);
  const [list, setList] = useState<Record<string, unknown>[]>([]);
  const [visibleCount, setVisibleCount] = useState(SEARCH_RESULTS_INITIAL_LIMIT);
  const [routeEta, setRouteEta] = useState<SearchRouteEtaState>({
    loading: false,
    durationMinutes: null,
    distanceKm: null,
  });

  /**
   * Modo favorito: la hora que edita el usuario siempre representa llegada deseada.
   * Con ambos pins se calcula salida (`fromTime`) usando duración de ruta.
   */
  const favoriteArrivalFirstUx = isFavoriteMode && originGeo != null && destGeo != null;
  /** Misma redacción en favorito desde que entra (no “Hora desde” / bloque distinto). */
  const favoriteArrivalCopy = isFavoriteMode;

  useLayoutEffect(() => {
    navigation.setOptions({
      title: favoriteSlot ? `Favorito: ${favoritePairLabel(favoriteSlot)}` : 'Buscar viajes',
    });
  }, [navigation, favoriteSlot]);

  useEffect(() => {
    if (!favoriteSlot || !userId) return;
    arrivalSyncedFromStoredPickupRef.current = false;
    let cancelled = false;
    void (async () => {
      const snap = await getPassengerFavorite(userId, favoriteSlot);
      if (cancelled) return;
      if (!snap) {
        setDate(toYmdLocal(new Date()));
        return;
      }
      setDate(snap.scheduledDateYmd?.trim() || snap.date?.trim() || toYmdLocal(new Date()));
      setFromTime(snap.scheduledTimeHm?.trim() || snap.fromTime);
      const storedArrival = snap.scheduledArrivalTimeHm?.trim();
      if (storedArrival) {
        setArrivalTimeHm(storedArrival);
        arrivalSyncedFromStoredPickupRef.current = true;
      } else {
        setArrivalTimeHm('');
        arrivalSyncedFromStoredPickupRef.current = false;
      }
      setShareCodeQuery('');
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
      setRideKind('internal');
      setScheduleDaily(Boolean(snap.scheduleDaily));
      setScheduleWeekdayMask(coerceScheduleWeekdayMask(snap.scheduleWeekdayMask));
    })();
    return () => {
      cancelled = true;
    };
  }, [favoriteSlot, userId]);

  useEffect(() => {
    if (!favoriteArrivalFirstUx) {
      arrivalSyncedFromStoredPickupRef.current = false;
    }
  }, [favoriteArrivalFirstUx]);

  /** Primera vez que hay duración del mapa: llegada = salida guardada + trayecto (migración desde UX anterior). */
  useEffect(() => {
    if (!favoriteArrivalFirstUx) return;
    if (arrivalSyncedFromStoredPickupRef.current) return;
    if (!date.trim() || !fromTime.trim()) return;
    if (routeEta.loading) return;
    if (routeEta.durationMinutes == null) return;
    const arr = addMinutesToHm(date, fromTime, routeEta.durationMinutes);
    if (arr) {
      setArrivalTimeHm(arr);
      arrivalSyncedFromStoredPickupRef.current = true;
    }
  }, [favoriteArrivalFirstUx, date, fromTime, routeEta.loading, routeEta.durationMinutes]);

  /** Llegada fija: al cambiar fecha, duración o ruta, actualizar salida guardada (`fromTime`). */
  useEffect(() => {
    if (!favoriteArrivalFirstUx || !arrivalSyncedFromStoredPickupRef.current) return;
    if (!date.trim() || !arrivalTimeHm.trim()) return;
    if (routeEta.loading) return;
    if (routeEta.durationMinutes == null) return;
    const pickup = subtractMinutesFromHm(date, arrivalTimeHm, routeEta.durationMinutes);
    if (pickup) setFromTime(pickup);
  }, [favoriteArrivalFirstUx, date, arrivalTimeHm, routeEta.loading, routeEta.durationMinutes]);

  const load = useCallback(async () => {
    setLoading(true);
    setList([]);
    const rawRouteOrCode = shareCodeQuery.trim();
    const normalizedShareCode = normalizeShareCodeInput(rawRouteOrCode);
    const singleFieldRouteName =
      normalizedShareCode || !rawRouteOrCode ? undefined : rawRouteOrCode;
    const rawDate = date.trim();
    const hmSearch = fromTime.trim();
    const shouldValidateLead = !normalizedShareCode && rawDate.length > 0 && hmSearch.length > 0;
    if (shouldValidateLead && !isPickupAtLeastLeadAhead(rawDate, hmSearch, MIN_BOOKING_LEAD_MS)) {
      setSearchLeadError(
        'Elegí fecha y hora de salida con al menos 4 horas de anticipación respecto de ahora (hora de este dispositivo).'
      );
      setLoading(false);
      return;
    }
    setSearchLeadError(null);
    try {
      const rows = (await searchRides({
        date: rawDate || undefined,
        fromTimeLocal: hmSearch || undefined,
        shareCode: normalizedShareCode || undefined,
        routeName: singleFieldRouteName,
        seats: 1,
      })) as Record<string, unknown>[];
      setList(applyRideKindFilter(rows, rideKind));
      setVisibleCount(SEARCH_RESULTS_INITIAL_LIMIT);
    } catch {
      setList([]);
      setVisibleCount(SEARCH_RESULTS_INITIAL_LIMIT);
    } finally {
      setLoading(false);
    }
  }, [date, fromTime, shareCodeQuery, rideKind]);

  const visibleList = useMemo(
    () => list.slice(0, Math.max(SEARCH_RESULTS_INITIAL_LIMIT, visibleCount)),
    [list, visibleCount]
  );
  const hasMoreResults = visibleList.length < list.length;

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
    if (!date.trim()) {
      Alert.alert('Datos incompletos', 'Elegí la fecha.');
      return;
    }
    if (favoriteArrivalCopy) {
      if (!arrivalTimeHm.trim()) {
        Alert.alert(
          'Datos incompletos',
          'Elegí la hora a la que necesitás llegar al destino.'
        );
        return;
      }
      if (favoriteArrivalFirstUx && !routeEta.loading && routeEta.durationMinutes == null) {
        Alert.alert(
          'Ruta en el mapa',
          'No se obtuvo duración por calles. Revisá los puntos o la conexión; sin eso no podemos calcular la salida desde la llegada.'
        );
        return;
      }
    } else if (!fromTime.trim()) {
      Alert.alert('Datos incompletos', 'Elegí la hora desde.');
      return;
    }

    const pickupToSave =
      favoriteArrivalCopy && arrivalTimeHm.trim()
        ? date.trim() && routeEta.durationMinutes != null
          ? subtractMinutesFromHm(date, arrivalTimeHm, routeEta.durationMinutes) ?? arrivalTimeHm.trim()
          : arrivalTimeHm.trim()
        : fromTime.trim();
    const scheduledHm = (pickupToSave || '08:00').trim() || '08:00';

    if (!isPickupAtLeastLeadAhead(date.trim(), scheduledHm, MIN_BOOKING_LEAD_MS)) {
      Alert.alert(
        'Anticipación mínima',
        favoriteArrivalCopy
          ? 'La salida estimada (recogida) tiene que ser al menos 4 horas desde ahora. Elegí una hora de llegada al destino más tarde u otra fecha.'
          : 'Elegí fecha y hora para que la salida o recogida sea al menos 4 horas desde ahora (hora de este dispositivo).'
      );
      return;
    }

    const hasOrigin = origin.trim().length > 0 || originGeo != null;
    const hasDest = destination.trim().length > 0 || destGeo != null;
    if (!hasOrigin || !hasDest) {
      Alert.alert('Datos incompletos', 'Indicá origen y destino (texto o mapa).');
      return;
    }
    const maskToSave = scheduleDaily ? coerceScheduleWeekdayMask(scheduleWeekdayMask) : SCHEDULE_WEEKDAY_MASK_ALL;
    if (scheduleDaily && maskToSave === 0) {
      Alert.alert('Días de la semana', 'Marcá al menos un día para el modo diario.');
      return;
    }

    if (saveFavoriteInFlightRef.current) return;
    saveFavoriteInFlightRef.current = true;
    setSavingFavorite(true);
    try {
      // Guardar config no activa demanda: el switch de Rutas guardadas crea la trip_request + atajo admin.
      await upsertPassengerFavorite(userId, favoriteSlot, {
        date: date.trim(),
        fromTime: scheduledHm,
        routeNameQuery: '',
        origin: origin.trim(),
        destination: destination.trim(),
        originLat: originGeo?.lat ?? null,
        originLng: originGeo?.lng ?? null,
        destinationLat: destGeo?.lat ?? null,
        destinationLng: destGeo?.lng ?? null,
        rideKind,
        enabled: false,
        scheduleDaily,
        scheduleWeekdayMask: scheduleDaily ? maskToSave : SCHEDULE_WEEKDAY_MASK_ALL,
        scheduledDateYmd: date.trim(),
        scheduledTimeHm: scheduledHm,
        scheduledArrivalTimeHm: favoriteArrivalCopy && arrivalTimeHm.trim() ? arrivalTimeHm.trim() : undefined,
        nextTriggerAtIso:
          computeNextTriggerIso(new Date(), date.trim(), scheduledHm, scheduleDaily, maskToSave) ?? undefined,
      });
      const store = await loadPassengerFavorites(userId);
      void pushPassengerHomeMapShortcuts(store);
      const lines = [`Se guardó tu favorito «${favoritePairLabel(favoriteSlot)}» en este dispositivo.`];
      lines.push('Para que figure en demanda agrupada y en el mapa admin, activá el switch desde Rutas.');

      Alert.alert('Guardado', lines.join('\n\n'), [
        {
          text: 'OK',
          onPress: () => navigation.navigate('MainTabs', { screen: 'SavedRoutes' }),
        },
      ]);
    } catch {
      Alert.alert('Error', 'No se pudo guardar el favorito. Intentá de nuevo.');
    } finally {
      saveFavoriteInFlightRef.current = false;
      setSavingFavorite(false);
    }
  }, [
    favoriteSlot,
    userId,
    date,
    fromTime,
    origin,
    destination,
    originGeo,
    destGeo,
    rideKind,
    scheduleDaily,
    scheduleWeekdayMask,
    arrivalTimeHm,
    routeEta.loading,
    routeEta.durationMinutes,
    favoriteArrivalFirstUx,
    navigation,
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

  const goCreateTripRequestFromSearch = useCallback(() => {
    const suggestedPricingKind =
      rideKind === 'internal' || rideKind === 'long_distance' ? rideKind : undefined;
    const rawRouteOrCode = shareCodeQuery.trim();
    const normalizedShareCode = normalizeShareCodeInput(rawRouteOrCode);
    const passengerRouteNameHint =
      !normalizedShareCode && rawRouteOrCode ? rawRouteOrCode : undefined;
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
      passengerRouteNameHint,
    });
  }, [navigation, rideKind, buscoFromSearch, shareCodeQuery]);

  const estimatedPickup = useMemo(
    () =>
      formatEstimatedPickupLine(date, arrivalTimeHm, routeEta, Boolean(originGeo && destGeo)),
    [date, arrivalTimeHm, routeEta, originGeo, destGeo]
  );

  const listHeader = useMemo(
    () => (
    <View>
      {isFavoriteMode ? (
        <>
          <View style={styles.mapCard}>
            <View style={styles.mapCollapsibleHeader}>
              <View style={styles.mapCollapsibleHeaderText}>
                <Text style={styles.mapCollapsibleTitle}>Mapa</Text>
                <Text style={styles.mapCollapsibleHint}>
                  {favoriteMapExpanded
                    ? 'Mové el mapa y confirmá origen y destino del favorito (ícono fijo al centro).'
                    : 'Mostrá el mapa para ajustar trayecto y horarios con la ruta.'}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.mapToggleBtn}
                onPress={() => setFavoriteMapExpanded((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={favoriteMapExpanded ? 'Ocultar mapa' : 'Mostrar mapa'}
              >
                <Ionicons
                  name={favoriteMapExpanded ? 'chevron-up-outline' : 'map-outline'}
                  size={favoriteMapExpanded ? 26 : 22}
                  color={PRIMARY}
                />
              </TouchableOpacity>
            </View>
            {favoriteMapExpanded ? (
              <View style={styles.mapInnerPad}>
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
                  hideInlineTitles
                />
              </View>
            ) : null}
          </View>
        </>
      ) : null}

      {favoriteSlot ? (
        <Text style={styles.formSectionKicker}>DETALLE DEL TRAYECTO</Text>
      ) : null}

      {!isFavoriteMode ? (
        <>
          <Text style={styles.label}>Ingrese código o nombre de ruta</Text>
          <TextInput
            style={styles.input}
            value={shareCodeQuery}
            onChangeText={(t) => setShareCodeQuery(t)}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Ingrese código o nombre de ruta"
            placeholderTextColor="#9ca3af"
          />
        </>
      ) : null}
      <Text style={styles.label}>
        {isFavoriteMode ? 'Fecha del viaje' : 'Fecha del viaje (opcional)'}
      </Text>
      <TouchableOpacity
        style={styles.pickerRow}
        onPress={() => setShowDatePicker(true)}
        accessibilityRole="button"
        accessibilityLabel="Elegir fecha"
      >
        <Text style={date.trim() ? styles.pickerValue : styles.pickerPlaceholder}>
          {date.trim() || (isFavoriteMode ? 'Elegí fecha' : 'Sin fecha')}
        </Text>
      </TouchableOpacity>
      {showDatePicker ? (
        <DateTimePicker
          value={
            (() => {
              const ymd = date.trim();
              if (ymd) {
                const d = new Date(ymd + 'T12:00:00');
                return clampDateNotBeforeLocalDay(d, new Date());
              }
              return startOfLocalDay();
            })()
          }
          mode="date"
          display={datePickerDisplay()}
          minimumDate={startOfLocalDay()}
          onChange={(ev, d) => {
            if (ev.type === 'dismissed') {
              setShowDatePicker(false);
              return;
            }
            if (Platform.OS !== 'ios') setShowDatePicker(false);
            if (d) setDate(toYmdLocal(clampDateNotBeforeLocalDay(d, new Date())));
          }}
        />
      ) : null}
      <Text style={styles.label}>{favoriteArrivalCopy ? 'Hora de llegada deseada' : 'Hora desde (opcional)'}</Text>
      <TouchableOpacity
        style={styles.pickerRow}
        onPress={() => setShowTimePicker(true)}
        accessibilityRole="button"
        accessibilityLabel={
          favoriteArrivalCopy
            ? favoriteArrivalFirstUx
              ? 'Elegir hora de llegada al destino'
              : 'Elegir hora de llegada al destino'
            : 'Elegir hora desde'
        }
      >
        <Text
          style={
            !favoriteArrivalCopy && !fromTime.trim()
              ? styles.pickerPlaceholder
              : favoriteArrivalCopy && !arrivalTimeHm.trim()
              ? styles.pickerPlaceholder
              : styles.pickerValue
          }
        >
          {favoriteArrivalCopy
            ? arrivalTimeHm.trim() || fromTime.trim() || '08:00'
            : fromTime.trim() || 'Sin hora'}
        </Text>
      </TouchableOpacity>
      {showTimePicker ? (
        <DateTimePicker
          value={(() => {
            const hm = favoriteArrivalCopy
              ? arrivalTimeHm.trim() || fromTime.trim() || '08:00'
              : fromTime.trim() || '08:00';
            const [h, m] = hm.split(':').map((x) => parseInt(x, 10));
            const d = new Date();
            d.setHours(Number.isFinite(h) ? h : 8, Number.isFinite(m) ? m : 0, 0, 0);
            return d;
          })()}
          mode="time"
          display={timePickerDisplay()}
          onChange={(ev, d) => {
            if (ev.type === 'dismissed') {
              setShowTimePicker(false);
              return;
            }
            if (Platform.OS !== 'ios') setShowTimePicker(false);
            if (d) {
              const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
              if (favoriteArrivalCopy) {
                setArrivalTimeHm(hm);
                arrivalSyncedFromStoredPickupRef.current = true;
                if (date.trim() && routeEta.durationMinutes != null) {
                  const p = subtractMinutesFromHm(date, hm, routeEta.durationMinutes);
                  if (p) setFromTime(p);
                }
              } else {
                setFromTime(hm);
              }
            }
          }}
        />
      ) : null}
      {favoriteSlot ? (
        <View style={styles.dailyRow}>
          <View style={styles.dailyTextWrap}>
            <Text style={styles.dailyTitle}>Reprogramar diario</Text>
            <Text style={styles.dailyHint}>
              {favoriteArrivalCopy
                ? 'Si activás, cada día se usa la misma hora de llegada y la salida se ajusta con la ruta del mapa.'
                : 'Si activás, se agenda todos los días a esta hora hasta apagar el switch en Rutas.'}
            </Text>
          </View>
          <Switch
            value={scheduleDaily}
            onValueChange={(v: boolean) => {
              setScheduleDaily(v);
              if (v) {
                setScheduleWeekdayMask((m) => {
                  const c = coerceScheduleWeekdayMask(m);
                  return c === 0 ? SCHEDULE_WEEKDAY_MASK_ALL : c;
                });
              }
            }}
            trackColor={{ false: '#d1d5db', true: '#b6e2c9' }}
            thumbColor={scheduleDaily ? PRIMARY : '#f3f4f6'}
          />
        </View>
      ) : null}
      {favoriteSlot && scheduleDaily ? (
        <View style={styles.weekdayBlock}>
          <Text style={styles.weekdayBlockTitle}>Días que usás este trayecto</Text>
          <Text style={styles.weekdayBlockHint}>
            Sin marcar un día, ese día no aplica el recordatorio ni la hora guardada (como si estuviera apagado ese día).
          </Text>
          <View style={styles.weekdayChipsRow}>
            {WEEKDAY_TOGGLE_LABELS.map((label, i) => {
              const on = ((scheduleWeekdayMask >> i) & 1) === 1;
              return (
                <TouchableOpacity
                  key={label}
                  style={[styles.weekdayChip, on && styles.weekdayChipOn]}
                  onPress={() => {
                    setScheduleWeekdayMask((m) => {
                      const next = (m ^ (1 << i)) & 127;
                      if (next === 0) return m;
                      return next;
                    });
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${label}, ${on ? 'activo' : 'inactivo'}`}
                >
                  <Text style={[styles.weekdayChipText, on && styles.weekdayChipTextOn]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null}
      {isFavoriteMode ? (
        <>
          <TouchableOpacity
            style={styles.advancedToggle}
            onPress={() => setAdvancedFiltersExpanded((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={advancedFiltersExpanded ? 'Ocultar filtros adicionales' : 'Ver filtros adicionales'}
          >
            <Text style={styles.advancedToggleText}>Más filtros</Text>
            <Ionicons
              name={advancedFiltersExpanded ? 'chevron-up' : 'chevron-down'}
              size={18}
              color="#64748b"
            />
          </TouchableOpacity>
          {advancedFiltersExpanded ? (
            <>
              <Text style={styles.label}>Tu transporte pasará aprox. a las:</Text>
              <View
                style={[styles.pickerRow, styles.pickerRowReadOnly]}
                accessibilityRole="text"
                accessibilityLabel={`Salida estimada: ${estimatedPickup.text}`}
              >
                <Text
                  style={
                    estimatedPickup.isPlaceholder ? styles.pickerPlaceholder : styles.pickerValue
                  }
                  selectable
                >
                  {estimatedPickup.text}
                </Text>
              </View>
              <Text style={styles.label}>Origen</Text>
              <TextInput
                style={styles.input}
                value={origin}
                onChangeText={(t) => {
                  setOrigin(t);
                  setOriginGeo(null);
                }}
                placeholder="Dirección o zona (opcional)"
                placeholderTextColor="#9ca3af"
              />
              <Text style={styles.label}>Destino</Text>
              <TextInput
                style={styles.input}
                value={destination}
                onChangeText={(t) => {
                  setDestination(t);
                  setDestGeo(null);
                }}
                placeholder="Dirección o zona (opcional)"
                placeholderTextColor="#9ca3af"
              />
            </>
          ) : null}
        </>
      ) : null}

      {!isFavoriteMode ? (
        <>
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
              <Text style={[styles.kindChipText, rideKind === 'internal' && styles.kindChipTextActive]}>
                Viajes disponibles
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.kindChip, rideKind === 'long_distance' && styles.kindChipActive]}
              onPress={() => setRideKind('long_distance')}
              accessibilityRole="button"
            >
              <Text style={[styles.kindChipText, rideKind === 'long_distance' && styles.kindChipTextActive]}>
                Ofertas de viajes
              </Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}

      {favoriteSlot ? (
        <TouchableOpacity
          style={[styles.searchBtn, savingFavorite && styles.searchBtnDisabled]}
          onPress={() => void saveFavorite()}
          disabled={savingFavorite}
          accessibilityRole="button"
          accessibilityState={{ busy: savingFavorite }}
          accessibilityLabel={
            savingFavorite
              ? 'Guardando favorito, esperá'
              : `Guardar favorito ${favoritePairLabel(favoriteSlot)}`
          }
        >
          <View style={styles.saveFavoriteBtnInner}>
            {savingFavorite ? (
              <ActivityIndicator color="#fff" style={styles.saveFavoriteSpinner} />
            ) : null}
            <Text style={styles.searchBtnText}>
              {savingFavorite ? 'Guardando…' : `Guardar ${favoritePairLabel(favoriteSlot)}`}
            </Text>
          </View>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.searchBtn} onPress={() => void load()} accessibilityRole="button">
          <Text style={styles.searchBtnText}>Buscar</Text>
        </TouchableOpacity>
      )}
      {!favoriteSlot && !loading && list.length > 0 ? (
        <Text style={styles.resultsHeaderCount} accessibilityRole="header">
          {list.length === 1 ? '1 viaje encontrado' : `${list.length} viajes encontrados`}
        </Text>
      ) : null}
    </View>
    ),
    [
      date,
      fromTime,
      origin,
      destination,
      originGeo,
      destGeo,
      rideKind,
      shareCodeQuery,
      load,
      saveFavorite,
      favoriteSlot,
      showDatePicker,
      showTimePicker,
      scheduleDaily,
      scheduleWeekdayMask,
      estimatedPickup,
      favoriteArrivalFirstUx,
      favoriteArrivalCopy,
      arrivalTimeHm,
      advancedFiltersExpanded,
      savingFavorite,
      list,
      loading,
      favoriteMapExpanded,
      isFavoriteMode,
    ]
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={visibleList}
        keyExtractor={(item) => String(item.id)}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={listHeader}
        ListFooterComponent={
          !favoriteSlot && !loading ? (
            <>
              {hasMoreResults ? (
                <TouchableOpacity
                  style={styles.loadMoreBtn}
                  onPress={() => setVisibleCount((prev) => prev + SEARCH_RESULTS_INITIAL_LIMIT)}
                  accessibilityRole="button"
                  accessibilityLabel="Ver más resultados"
                >
                  <Text style={styles.loadMoreBtnText}>Ver más</Text>
                </TouchableOpacity>
              ) : null}
              {visibleList.length > 0 ? (
                <View style={styles.postSearchCta}>
                  <Text style={styles.postSearchCtaHint}>¿No encontrás lo que buscás?</Text>
                  <TouchableOpacity
                    style={styles.postSearchCtaBtn}
                    onPress={goCreateTripRequestFromSearch}
                    accessibilityRole="button"
                    accessibilityLabel="Crear viaje con los datos de la búsqueda"
                  >
                    <Text style={styles.postSearchCtaBtnText}>Crear viaje con estos datos</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </>
          ) : null
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={styles.listSpinner} size="large" color={PRIMARY} />
          ) : favoriteSlot ? null : searchLeadError ? (
            <View style={styles.emptyBlock}>
              <Text style={styles.emptyTitle}>Revisá fecha y hora</Text>
              <Text style={styles.emptyLead}>{searchLeadError}</Text>
              <TouchableOpacity
                style={styles.emptyPrimaryBtn}
                onPress={goCreateTripRequestFromSearch}
                accessibilityRole="button"
                accessibilityLabel="Crear viaje con los datos ingresados"
              >
                <Text style={styles.emptyPrimaryBtnText}>Crear viaje con estos datos</Text>
              </TouchableOpacity>
            </View>
          ) : normalizeShareCodeInput(shareCodeQuery) ? (
            <View style={styles.emptyBlock}>
              <Text style={styles.emptyTitle}>No se encontró viaje con ese código</Text>
              <Text style={styles.emptyLead}>
                Revisá el código compartido por el conductor (formato esperado: XH-ABC123) e intentá de nuevo. También
                podés crear una solicitud con origen y destino en el mapa.
              </Text>
              <TouchableOpacity
                style={styles.emptyPrimaryBtn}
                onPress={goCreateTripRequestFromSearch}
                accessibilityRole="button"
                accessibilityLabel="Crear viaje con origen y destino del mapa"
              >
                <Text style={styles.emptyPrimaryBtnText}>Crear viaje con estos datos</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <SearchEmptyResults
              onCreateTripRequest={goCreateTripRequestFromSearch}
            />
          )
        }
        renderItem={({ item }) => {
          const row = item as Record<string, unknown>;
          const depStr = row.departure_time != null ? String(row.departure_time) : '';
          const dep = depStr ? new Date(depStr) : null;
          const depValid = dep != null && !Number.isNaN(dep.getTime());
          const now = new Date();
          const originParts = splitPlaceLabel(String(row.origin_label ?? ''));
          const destParts = splitPlaceLabel(String(row.destination_label ?? ''));
          const rName = String(row.route_name ?? '').trim();
          const avail = Math.max(0, Math.round(Number(row.available_seats ?? 0)));
          const totalRaw = Math.round(Number(row.total_seats ?? 0));
          const total = totalRaw > 0 ? totalRaw : Math.max(avail, 1);
          const ratio = total > 0 ? avail / total : 0;
          const barColor = avail <= 2 || ratio <= 0.15 ? '#ef4444' : ratio <= 0.35 ? '#f59e0b' : '#22c55e';
          const dayLine = depValid ? relativeDayLineEs(dep, now) : '—';
          const timeLine = depValid ? formatDepartureHmEs(dep) : '—';
          const a11y = `${rName ? `${rName}. ` : ''}De ${originParts.main} a ${destParts.main}. ${dayLine} ${timeLine}. ${avail} de ${total} cupos.`;

          return (
            <TouchableOpacity
              style={styles.tripCard}
              onPress={() => navigation.navigate('RideDetail', { rideId: String(row.id) })}
              accessibilityRole="button"
              accessibilityLabel={a11y}
            >
              <View style={styles.tripCardHeaderRow}>
                <View style={styles.tripCardTitleCol}>
                  {rName ? (
                    <Text style={styles.tripCardRouteName} numberOfLines={1}>
                      {rName}
                    </Text>
                  ) : (
                    <Text style={styles.tripCardRouteNameMuted} numberOfLines={1}>
                      Viaje publicado
                    </Text>
                  )}
                </View>
                <View style={styles.tripDayPill}>
                  <Text style={styles.tripDayPillText}>{dayLine}</Text>
                </View>
              </View>
              <View style={styles.tripTimeRow}>
                <Ionicons name="time-outline" size={17} color="#6b7280" />
                <Text style={styles.tripTimeText}>{timeLine}</Text>
              </View>
              <View style={styles.tripJourneyRow}>
                <View style={styles.tripJourneyRail}>
                  <View style={styles.tripDotOrigin} />
                  <View style={styles.tripRailLine} />
                  <View style={styles.tripDotDest} />
                </View>
                <View style={styles.tripJourneyCol}>
                  <Text style={styles.tripPlaceTitle} numberOfLines={2}>
                    {originParts.main}
                  </Text>
                  {originParts.detail ? (
                    <Text style={styles.tripPlaceDetail} numberOfLines={2}>
                      {originParts.detail}
                    </Text>
                  ) : null}
                  <View style={styles.tripJourneySpacer} />
                  <Text style={styles.tripPlaceTitle} numberOfLines={2}>
                    {destParts.main}
                  </Text>
                  {destParts.detail ? (
                    <Text style={styles.tripPlaceDetail} numberOfLines={2}>
                      {destParts.detail}
                    </Text>
                  ) : null}
                </View>
              </View>
              <Text style={styles.tripSeatsCaption}>Cupos disponibles</Text>
              <View style={styles.tripSeatsRow}>
                <View style={styles.tripSeatsBarTrack}>
                  <View
                    style={[
                      styles.tripSeatsBarFill,
                      { flex: Math.max(0.02, avail), backgroundColor: barColor },
                    ]}
                  />
                  <View style={{ flex: Math.max(0.02, total - avail) }} />
                </View>
                <Text style={styles.tripSeatsFraction}>
                  {avail}/{total}
                </Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: PAGE_BG },
  listContent: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 32 },
  mapCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#eef0f3',
    marginBottom: 18,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  mapInnerPad: { paddingHorizontal: 12, paddingBottom: 12 },
  mapCollapsibleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eef0f3',
  },
  mapCollapsibleHeaderText: { flex: 1, minWidth: 0 },
  mapCollapsibleTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.9,
    color: '#64748b',
    marginBottom: 6,
    fontFamily: appBrand.fonts.semibold,
    textTransform: 'uppercase',
  },
  mapCollapsibleHint: { fontSize: 13, color: '#64748b', lineHeight: 19, fontFamily: appBrand.fonts.regular },
  mapToggleBtn: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#edf7f1',
    borderWidth: 1,
    borderColor: '#c6e6d3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  formSectionKicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.9,
    color: '#64748b',
    fontFamily: appBrand.fonts.semibold,
    marginBottom: 8,
    marginTop: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.75,
    color: '#64748b',
    marginBottom: 6,
    marginTop: 4,
    fontFamily: appBrand.fonts.semibold,
  },
  favoriteTimeHint: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 17,
    marginBottom: 8,
    marginTop: -2,
    fontFamily: appBrand.fonts.regular,
  },
  pickerRow: {
    borderWidth: 1,
    borderColor: '#e8eaed',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 12,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  pickerRowReadOnly: {
    backgroundColor: '#f7f8fa',
  },
  advancedToggle: {
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#eef0f3',
    borderRadius: 16,
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  advancedToggleText: { fontSize: 14, fontWeight: '800', color: '#0f172a', fontFamily: appBrand.fonts.semibold },
  dailyRow: {
    borderWidth: 1,
    borderColor: '#eef0f3',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  dailyRowMuted: { opacity: 0.65 },
  dailyTextWrap: { flex: 1 },
  dailyTitle: { fontSize: 15, fontWeight: '800', color: PRIMARY, fontFamily: appBrand.fonts.semibold },
  dailyHint: { fontSize: 12, color: '#64748b', lineHeight: 17, marginTop: 4, fontFamily: appBrand.fonts.regular },
  weekdayBlock: {
    borderWidth: 1,
    borderColor: '#c6e6d3',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
    backgroundColor: '#edf7f1',
  },
  weekdayBlockTitle: { fontSize: 14, fontWeight: '800', color: PRIMARY, fontFamily: appBrand.fonts.semibold },
  weekdayBlockHint: { fontSize: 12, color: '#475569', lineHeight: 17, marginTop: 6, fontFamily: appBrand.fonts.regular },
  weekdayChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  weekdayChip: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  weekdayChipOn: {
    borderColor: PRIMARY,
    backgroundColor: PRIMARY,
  },
  weekdayChipText: { fontSize: 12, fontWeight: '800', color: '#475569', fontFamily: appBrand.fonts.semibold },
  weekdayChipTextOn: { color: '#fff' },
  etaHint: {
    fontSize: 12,
    color: '#94a3b8',
    lineHeight: 17,
    marginBottom: 10,
    marginTop: -4,
    fontFamily: appBrand.fonts.regular,
  },
  pickerValue: { fontSize: 16, color: '#0f172a', fontFamily: appBrand.fonts.semibold },
  pickerPlaceholder: { fontSize: 16, color: '#94a3b8', fontFamily: appBrand.fonts.regular },
  input: {
    borderWidth: 1,
    borderColor: '#e8eaed',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    fontSize: 16,
    backgroundColor: '#fff',
    color: '#0f172a',
    fontFamily: appBrand.fonts.regular,
  },
  clearLink: { fontSize: 13, color: PRIMARY, fontWeight: '700', marginBottom: 10, fontFamily: appBrand.fonts.semibold },
  kindRow: { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  kindChip: {
    borderWidth: 1,
    borderColor: '#e8eaed',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
  },
  kindChipActive: {
    borderColor: PRIMARY,
    backgroundColor: PRIMARY,
  },
  kindChipText: { fontSize: 13, color: '#475569', fontWeight: '700', fontFamily: appBrand.fonts.semibold },
  kindChipTextActive: { color: '#fff', fontFamily: appBrand.fonts.semibold },
  searchBtn: {
    backgroundColor: PRIMARY,
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
    marginBottom: 10,
    marginTop: 4,
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 4,
  },
  searchBtnDisabled: { opacity: 0.7 },
  saveFavoriteBtnInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  saveFavoriteSpinner: { marginRight: 10 },
  searchBtnText: { color: '#fff', fontWeight: '800', fontSize: 15, fontFamily: appBrand.fonts.semibold },
  loadMoreBtn: {
    borderWidth: 2,
    borderColor: PRIMARY,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 14,
    backgroundColor: '#fff',
  },
  loadMoreBtnText: { color: PRIMARY, fontWeight: '800', fontFamily: appBrand.fonts.semibold },
  postSearchCta: {
    marginTop: 8,
    marginBottom: 20,
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#c6e6d3',
    backgroundColor: '#edf7f1',
    alignItems: 'center',
  },
  postSearchCtaHint: {
    fontSize: 14,
    color: '#334155',
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
    fontFamily: appBrand.fonts.semibold,
  },
  postSearchCtaBtn: {
    borderWidth: 2,
    borderColor: PRIMARY,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: '#fff',
  },
  postSearchCtaBtnText: { color: PRIMARY, fontWeight: '800', fontSize: 15, fontFamily: appBrand.fonts.semibold },
  listSpinner: { marginTop: 28 },
  resultsHeaderCount: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 0.9,
    marginTop: 8,
    marginBottom: 10,
    fontFamily: appBrand.fonts.semibold,
  },
  tripCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#eef0f3',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  tripCardHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  tripCardTitleCol: { flex: 1, minWidth: 0 },
  tripCardRouteName: { fontSize: 15, fontWeight: '800', color: PRIMARY, fontFamily: appBrand.fonts.semibold },
  tripCardRouteNameMuted: { fontSize: 14, fontWeight: '700', color: '#94a3b8', fontFamily: appBrand.fonts.semibold },
  tripDayPill: {
    backgroundColor: '#edf7f1',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#c6e6d3',
  },
  tripDayPillText: { fontSize: 12, fontWeight: '800', color: PRIMARY, fontFamily: appBrand.fonts.semibold },
  tripTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, marginBottom: 12 },
  tripTimeText: { fontSize: 15, fontWeight: '800', color: '#0f172a', fontFamily: appBrand.fonts.semibold },
  tripJourneyRow: { flexDirection: 'row', alignItems: 'stretch', gap: 12 },
  tripJourneyRail: { width: 14, alignItems: 'center', paddingTop: 4 },
  tripDotOrigin: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: PRIMARY,
    borderWidth: 2,
    borderColor: '#c6e6d3',
  },
  tripRailLine: { flex: 1, width: 3, backgroundColor: '#c6e6d3', marginVertical: 4, borderRadius: 2, minHeight: 28 },
  tripDotDest: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 3,
    borderColor: PRIMARY,
    backgroundColor: '#fff',
  },
  tripJourneyCol: { flex: 1, minWidth: 0 },
  tripPlaceTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a', lineHeight: 22, fontFamily: appBrand.fonts.semibold },
  tripPlaceDetail: { fontSize: 12, color: '#64748b', lineHeight: 17, marginTop: 2, fontFamily: appBrand.fonts.regular },
  tripJourneySpacer: { height: 14 },
  tripSeatsCaption: { fontSize: 12, fontWeight: '700', color: '#6b7280', marginTop: 14, marginBottom: 6 },
  tripSeatsRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tripSeatsBarTrack: {
    flex: 1,
    flexDirection: 'row',
    height: 8,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#e5e7eb',
  },
  tripSeatsBarFill: { minHeight: 8, alignSelf: 'stretch' },
  tripSeatsFraction: { fontSize: 14, fontWeight: '800', color: PRIMARY, minWidth: 52, textAlign: 'right', fontFamily: appBrand.fonts.semibold },
  emptyBlock: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
    marginBottom: 10,
    fontFamily: appBrand.fonts.semibold,
  },
  emptyLead: {
    fontSize: 14,
    color: '#64748b',
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 16,
    fontFamily: appBrand.fonts.regular,
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
    borderWidth: 2,
    borderColor: PRIMARY,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
    backgroundColor: '#fff',
  },
  emptyLinkBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: PRIMARY,
    textAlign: 'center',
    fontFamily: appBrand.fonts.semibold,
  },
  emptyPrimaryBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 16,
    paddingVertical: 15,
    paddingHorizontal: 14,
    marginBottom: 10,
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  emptyPrimaryBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
    fontFamily: appBrand.fonts.semibold,
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
