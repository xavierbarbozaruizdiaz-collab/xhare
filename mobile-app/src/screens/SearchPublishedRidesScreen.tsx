/**
 * Buscar viajes publicados: fecha y hora desde obligatorias; origen/destino por texto y/o mapa; tipo de viaje.
 * Con `favoriteSlot` en la ruta: mismo formulario solo para guardar trayecto favorito (p. ej. Casa → Trabajo).
 */
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
import { searchRides, saveTripRequest } from '../rides/api';
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
  coerceScheduleWeekdayMask,
  SCHEDULE_WEEKDAY_MASK_ALL,
} from '../lib/passengerFavorites';
import { pushPassengerHomeMapShortcuts } from '../backend/passengerHomeMapShortcutSync';
import { useAuth } from '../auth/AuthContext';
import { isPickupAtLeastLeadAhead, MIN_BOOKING_LEAD_MS } from '../lib/bookingLead';

type Nav = NativeStackNavigationProp<MainStackParamList, 'SearchPublishedRides'>;

const WEEKDAY_TOGGLE_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const;

function normalizeHmForTripRequest(hm: string): string {
  const m = hm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '08:00';
  const hh = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const mm = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function toYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYmdHm(dateYmd: string, hm: string): Date | null {
  const [yy, mm, dd] = dateYmd.trim().split('-').map((x) => parseInt(x, 10));
  const mt = hm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!mt) return null;
  const h = parseInt(mt[1], 10);
  const mi = parseInt(mt[2], 10);
  if (![yy, mm, dd, h, mi].every((n) => Number.isFinite(n))) return null;
  return new Date(yy, mm - 1, dd, h, mi, 0, 0);
}

function formatHmFromDate(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function addMinutesToHm(dateYmd: string, fromHm: string, addMinutes: number): string | null {
  const dep = parseYmdHm(dateYmd, fromHm);
  if (!dep) return null;
  return formatHmFromDate(new Date(dep.getTime() + addMinutes * 60_000));
}

function subtractMinutesFromHm(dateYmd: string, arrivalHm: string, subMinutes: number): string | null {
  const arr = parseYmdHm(dateYmd, arrivalHm);
  if (!arr) return null;
  return formatHmFromDate(new Date(arr.getTime() - subMinutes * 60_000));
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

/** Modo favorito: llegada deseada → salida estimada restando la duración del mapa. */
function formatEstimatedPickupLine(
  dateYmd: string,
  arrivalHm: string,
  routeEta: SearchRouteEtaState,
  hasOriginDestPins: boolean
): { text: string; isPlaceholder: boolean } {
  if (!hasOriginDestPins) {
    return { text: 'Marcá origen y destino en el mapa', isPlaceholder: true };
  }
  if (!dateYmd.trim() || !arrivalHm.trim()) {
    return { text: 'Completá fecha y hora de llegada deseada', isPlaceholder: true };
  }
  if (routeEta.loading) {
    return { text: 'Calculando ruta…', isPlaceholder: true };
  }
  if (routeEta.durationMinutes == null) {
    return { text: 'No disponible (sin duración del trayecto)', isPlaceholder: true };
  }
  const pickup = subtractMinutesFromHm(dateYmd, arrivalHm, routeEta.durationMinutes);
  if (!pickup) {
    return { text: 'Hora de llegada no válida', isPlaceholder: true };
  }
  const dep = parseYmdHm(dateYmd, pickup);
  if (!dep) {
    return { text: '—', isPlaceholder: true };
  }
  const hm = dep.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' });
  const mins = Math.round(routeEta.durationMinutes);
  return {
    text: `~${hm} salida estimada (${mins} min antes, según la ruta del mapa)`,
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
  onCreateTripRequest,
}: {
  navigation: Nav;
  onCreateTripRequest: () => void;
}) {
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
          onPress={onCreateTripRequest}
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
  /** HH:MM (24 h): en favoritos = salida/recogida (persistido); en búsqueda = hora desde. */
  const [fromTime, setFromTime] = useState('08:00');
  /** Solo favoritos: hora a la que el usuario necesita llegar al destino (entrada principal). */
  const [arrivalTimeHm, setArrivalTimeHm] = useState('');
  const arrivalSyncedFromStoredPickupRef = useRef(false);
  const [routeNameQuery, setRouteNameQuery] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [originGeo, setOriginGeo] = useState<Point | null>(null);
  const [destGeo, setDestGeo] = useState<Point | null>(null);
  const [rideKind, setRideKind] = useState<'all' | 'internal' | 'long_distance'>('all');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [scheduleDaily, setScheduleDaily] = useState(false);
  /** Bits 0=domingo … 6=sábado (`Date.getDay`). Solo con `scheduleDaily`. */
  const [scheduleWeekdayMask, setScheduleWeekdayMask] = useState(SCHEDULE_WEEKDAY_MASK_ALL);
  /** Además del favorito: crear `trip_requests` pending (demanda / ruta en sistema). Solo interno/`todos`. */
  const [registerTripRequest, setRegisterTripRequest] = useState(true);
  const [loading, setLoading] = useState(!isFavoriteMode);
  /** Búsqueda: fecha/hora “desde” demasiado pronto (< 4 h). */
  const [searchLeadError, setSearchLeadError] = useState<string | null>(null);
  const [list, setList] = useState<Record<string, unknown>[]>([]);
  const [routeEta, setRouteEta] = useState<SearchRouteEtaState>({
    loading: false,
    durationMinutes: null,
    distanceKm: null,
  });

  /**
   * Con ambos pins: llegada deseada → salida según polyline; guardado y efectos usan esta rama.
   * Sin ambos pins: mismo texto en pantalla (“llegada deseada”, etc.) pero el reloj editá `fromTime` (salida guardada).
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
      if (cancelled || !snap) return;
      setDate(snap.scheduledDateYmd?.trim() || snap.date);
      setFromTime(snap.scheduledTimeHm?.trim() || snap.fromTime);
      setArrivalTimeHm('');
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

  useEffect(() => {
    if (isFavoriteMode && (!originGeo || !destGeo)) {
      setArrivalTimeHm('');
    }
  }, [isFavoriteMode, originGeo, destGeo]);

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
    const hmSearch = fromTime.trim() || '08:00';
    if (!isPickupAtLeastLeadAhead(date.trim(), hmSearch, MIN_BOOKING_LEAD_MS)) {
      setSearchLeadError(
        'Elegí fecha y hora de salida con al menos 4 horas de anticipación respecto de ahora (hora de este dispositivo).'
      );
      setLoading(false);
      return;
    }
    setSearchLeadError(null);
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

  useEffect(() => {
    if (rideKind === 'long_distance') setRegisterTripRequest(false);
  }, [rideKind]);

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
    if (favoriteArrivalFirstUx) {
      if (!arrivalTimeHm.trim()) {
        Alert.alert(
          'Datos incompletos',
          'Elegí la hora a la que necesitás llegar (o esperá a que el mapa calcule la ruta si acabás de marcar origen y destino).'
        );
        return;
      }
      if (!routeEta.loading && routeEta.durationMinutes == null) {
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
      favoriteArrivalFirstUx &&
      arrivalTimeHm.trim() &&
      date.trim() &&
      routeEta.durationMinutes != null
        ? subtractMinutesFromHm(date, arrivalTimeHm, routeEta.durationMinutes) ?? fromTime.trim()
        : fromTime.trim();
    const scheduledHm = (pickupToSave || '08:00').trim() || '08:00';

    if (!isPickupAtLeastLeadAhead(date.trim(), scheduledHm, MIN_BOOKING_LEAD_MS)) {
      Alert.alert(
        'Anticipación mínima',
        favoriteArrivalFirstUx
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
    try {
      await upsertPassengerFavorite(userId, favoriteSlot, {
        date: date.trim(),
        fromTime: scheduledHm,
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
        scheduleWeekdayMask: scheduleDaily ? maskToSave : SCHEDULE_WEEKDAY_MASK_ALL,
        scheduledDateYmd: date.trim(),
        scheduledTimeHm: scheduledHm,
        nextTriggerAtIso:
          computeNextTriggerIso(new Date(), date.trim(), scheduledHm, scheduleDaily, maskToSave) ?? undefined,
      });
      const store = await loadPassengerFavorites(userId);
      void pushPassengerHomeMapShortcuts(store);

      let tripErr: string | undefined;
      const token = session?.access_token?.trim();
      const canPostTrip =
        registerTripRequest &&
        rideKind !== 'long_distance' &&
        originGeo != null &&
        destGeo != null &&
        Boolean(token);
      if (canPostTrip && token && originGeo && destGeo) {
        const poly =
          routeEta.polyline != null && routeEta.polyline.length >= 2 ? routeEta.polyline : undefined;
        const tripRes = await saveTripRequest({
          accessToken: token,
          userId,
          originLat: originGeo.lat,
          originLng: originGeo.lng,
          originLabel: (origin.trim() || 'Origen').slice(0, 500),
          destinationLat: destGeo.lat,
          destinationLng: destGeo.lng,
          destinationLabel: (destination.trim() || 'Destino').slice(0, 500),
          requestedDate: date.trim(),
          requestedTime: normalizeHmForTripRequest(scheduledHm),
          seats: 1,
          routePolyline: poly ?? null,
          routeLengthKm: routeEta.distanceKm ?? null,
          pricingKind: 'internal',
          internalQuoteAcknowledged: true,
          passengerFavoriteSlot: favoriteSlot,
        });
        if (!tripRes.ok) tripErr = tripRes.error;
      } else if (registerTripRequest && rideKind !== 'long_distance' && (!originGeo || !destGeo)) {
        tripErr =
          'Para registrar la solicitud en el sistema marcá origen y destino en el mapa (con ruta por calles).';
      }

      const lines = [`Se guardó tu favorito «${favoritePairLabel(favoriteSlot)}» en este dispositivo.`];
      if (canPostTrip && !tripErr) {
        lines.push('También quedó una solicitud de viaje pendiente (demanda / clasificación en el servidor).');
      }
      if (tripErr) lines.push(`Solicitud de viaje: ${tripErr}`);

      Alert.alert('Guardado', lines.join('\n\n'), [
        {
          text: 'OK',
          onPress: () => navigation.navigate('MainTabs'),
        },
      ]);
    } catch {
      Alert.alert('Error', 'No se pudo guardar el favorito. Intentá de nuevo.');
    }
  }, [
    favoriteSlot,
    userId,
    session,
    date,
    fromTime,
    routeNameQuery,
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
    routeEta.polyline,
    routeEta.distanceKm,
    favoriteArrivalFirstUx,
    registerTripRequest,
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
  }, [navigation, rideKind, buscoFromSearch]);

  const estimatedArrival = useMemo(
    () =>
      formatEstimatedArrivalLine(date, fromTime, routeEta, Boolean(originGeo && destGeo)),
    [date, fromTime, routeEta, originGeo, destGeo]
  );

  const estimatedPickup = useMemo(
    () =>
      formatEstimatedPickupLine(date, arrivalTimeHm, routeEta, Boolean(originGeo && destGeo)),
    [date, arrivalTimeHm, routeEta, originGeo, destGeo]
  );

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
      <Text style={styles.label}>
        {favoriteArrivalCopy ? 'Hora de llegada deseada' : 'Hora desde'}
      </Text>
      {favoriteArrivalCopy && !favoriteArrivalFirstUx ? (
        <Text style={styles.favoriteTimeHint}>
          Marcá origen y destino en el mapa para calcular la llegada con la ruta. Sin ambos puntos, esta hora es la de
          salida/recogida guardada.
        </Text>
      ) : null}
      <TouchableOpacity
        style={styles.pickerRow}
        onPress={() => setShowTimePicker(true)}
        accessibilityRole="button"
        accessibilityLabel={
          favoriteArrivalCopy
            ? favoriteArrivalFirstUx
              ? 'Elegir hora de llegada al destino'
              : 'Elegir hora de salida o recogida hasta marcar mapa completo'
            : 'Elegir hora desde'
        }
      >
        <Text
          style={
            favoriteArrivalFirstUx && !arrivalTimeHm.trim()
              ? styles.pickerPlaceholder
              : styles.pickerValue
          }
        >
          {favoriteArrivalFirstUx
            ? arrivalTimeHm.trim() || '—'
            : fromTime.trim() || '08:00'}
        </Text>
      </TouchableOpacity>
      {showTimePicker ? (
        <DateTimePicker
          value={(() => {
            const hm = favoriteArrivalFirstUx
              ? arrivalTimeHm.trim() || fromTime.trim() || '08:00'
              : fromTime.trim() || '08:00';
            const [h, m] = hm.split(':').map((x) => parseInt(x, 10));
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
              const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
              if (favoriteArrivalFirstUx) {
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
                : 'Si activás, se agenda todos los días a esta hora hasta apagar el switch en Inicio.'}
            </Text>
          </View>
          <Switch
            value={scheduleDaily}
            onValueChange={(v) => {
              setScheduleDaily(v);
              if (v) {
                setScheduleWeekdayMask((m) => {
                  const c = coerceScheduleWeekdayMask(m);
                  return c === 0 ? SCHEDULE_WEEKDAY_MASK_ALL : c;
                });
              }
            }}
            trackColor={{ false: '#d1d5db', true: '#86efac' }}
            thumbColor={scheduleDaily ? '#166534' : '#f3f4f6'}
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
      <Text style={styles.label}>
        {favoriteArrivalCopy ? 'Salida estimada (recogida)' : 'Llegada estimada en destino'}
      </Text>
      <View
        style={[styles.pickerRow, styles.pickerRowReadOnly]}
        accessibilityRole="text"
        accessibilityLabel={
          favoriteArrivalCopy
            ? `Salida estimada: ${estimatedPickup.text}`
            : `Llegada estimada: ${estimatedArrival.text}`
        }
      >
        <Text
          style={
            (favoriteArrivalCopy ? estimatedPickup : estimatedArrival).isPlaceholder
              ? styles.pickerPlaceholder
              : styles.pickerValue
          }
          selectable
        >
          {(favoriteArrivalCopy ? estimatedPickup : estimatedArrival).text}
        </Text>
      </View>
      <Text style={styles.etaHint}>
        {favoriteArrivalCopy
          ? 'La salida se recalcula al cambiar la ruta en el mapa (duración por calles). Puede variar con el tráfico y el recorrido real.'
          : 'El horario de llegada es estimado: puede variar según el tráfico, el recorrido real del viaje y otros pasajeros.'}
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
        <View style={[styles.dailyRow, rideKind === 'long_distance' && styles.dailyRowMuted]}>
          <View style={styles.dailyTextWrap}>
            <Text style={styles.dailyTitle}>Registrar también solicitud de viaje</Text>
            <Text style={styles.dailyHint}>
              Pedido <Text style={{ fontWeight: '700' }}>pending</Text> con la misma fecha, hora de recogida y ruta del
              mapa, para demanda y mapa admin. Larga distancia: usá el flujo con precio (no aplica acá).
            </Text>
          </View>
          <Switch
            value={registerTripRequest && rideKind !== 'long_distance'}
            onValueChange={setRegisterTripRequest}
            disabled={rideKind === 'long_distance'}
            trackColor={{ false: '#d1d5db', true: '#86efac' }}
            thumbColor={registerTripRequest && rideKind !== 'long_distance' ? '#166534' : '#f3f4f6'}
          />
        </View>
      ) : null}

      {favoriteSlot ? (
        <TouchableOpacity style={styles.searchBtn} onPress={() => void saveFavorite()} accessibilityRole="button">
          <Text style={styles.searchBtnText}>Guardar {favoritePairLabel(favoriteSlot)}</Text>
        </TouchableOpacity>
      ) : (
        <>
          <TouchableOpacity
            style={styles.createFromSearchBtn}
            onPress={goCreateTripRequestFromSearch}
            accessibilityRole="button"
            accessibilityLabel="Crear solicitud de trayecto con los datos de arriba"
          >
            <Text style={styles.createFromSearchBtnText}>Crear solicitud de trayecto</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.searchBtn} onPress={() => void load()} accessibilityRole="button">
            <Text style={styles.searchBtnText}>Buscar</Text>
          </TouchableOpacity>
        </>
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
      scheduleWeekdayMask,
      registerTripRequest,
      rideKind,
      estimatedArrival,
      estimatedPickup,
      favoriteArrivalFirstUx,
      favoriteArrivalCopy,
      arrivalTimeHm,
      goCreateTripRequestFromSearch,
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
          ) : favoriteSlot ? null : searchLeadError ? (
            <View style={styles.emptyBlock}>
              <Text style={styles.emptyTitle}>Anticipación mínima</Text>
              <Text style={styles.emptyLead}>{searchLeadError}</Text>
            </View>
          ) : (
            <SearchEmptyResults
              navigation={navigation}
              onCreateTripRequest={goCreateTripRequestFromSearch}
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
  favoriteTimeHint: {
    fontSize: 12,
    color: '#6b7280',
    lineHeight: 17,
    marginBottom: 8,
    marginTop: -2,
  },
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
  dailyRowMuted: { opacity: 0.65 },
  dailyTextWrap: { flex: 1 },
  dailyTitle: { fontSize: 14, fontWeight: '700', color: '#14532d' },
  dailyHint: { fontSize: 12, color: '#6b7280', lineHeight: 17, marginTop: 2 },
  weekdayBlock: {
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    backgroundColor: '#f0fdf4',
  },
  weekdayBlockTitle: { fontSize: 14, fontWeight: '700', color: '#14532d' },
  weekdayBlockHint: { fontSize: 12, color: '#4b5563', lineHeight: 17, marginTop: 4 },
  weekdayChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  weekdayChip: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
  },
  weekdayChipOn: {
    borderColor: '#166534',
    backgroundColor: '#166534',
  },
  weekdayChipText: { fontSize: 12, fontWeight: '700', color: '#374151' },
  weekdayChipTextOn: { color: '#fff' },
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
  createFromSearchBtn: {
    borderWidth: 2,
    borderColor: '#166534',
    backgroundColor: '#fff',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 10,
  },
  createFromSearchBtnText: {
    color: '#166534',
    fontWeight: '700',
    fontSize: 16,
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
