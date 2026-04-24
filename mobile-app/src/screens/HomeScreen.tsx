/**
 * Home base: bienvenida, favoritos (pasajero), accesos rapidos, banners conductor/admin.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Modal,
  Pressable,
  Switch,
  AppState,
  Platform,
  ActivityIndicator,
  type AppStateStatus,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import type { MainTabParamList } from '../navigation/types';
import { getAppFlavor } from '../core/flavor';
import {
  fetchPassengerHomeFavoritesCopy,
  fetchPassengerHomeShortcutsVisible,
  DEFAULT_PASSENGER_HOME_FAVORITES_TITLE,
  DEFAULT_PASSENGER_HOME_FAVORITES_SUBTITLE,
} from '../backend/passengerUiSettings';
import { pushPassengerHomeMapShortcuts } from '../backend/passengerHomeMapShortcutSync';
import {
  loadPassengerFavorites,
  getPassengerFavorite,
  upsertPassengerFavorite,
  removePassengerFavorite,
  getFavoritePreset,
  favoritePairLabel,
  isFavoriteEnabled,
  computeNextTriggerIso,
  coerceScheduleWeekdayMask,
  scheduleWeekdayMaskLabelEs,
  findFavoritePresetIdByIcons,
  FAVORITE_PRESET_IDS,
  type PassengerFavoriteSlot,
  type PassengerFavoriteSnapshot,
} from '../lib/passengerFavorites';
import {
  addDaysToYmd,
  isPickupAtLeastLeadAhead,
  MIN_BOOKING_LEAD_MS,
  parseLocalYmdHm,
} from '../lib/bookingLead';
import { fetchRoute } from '../backend/routeApi';
import { distanceMeters } from '../lib/geo';
import {
  loadActivePricingSettings,
  computeEffectivePricing,
  type EffectivePricing,
} from '../lib/pricing/runtime-pricing';
import {
  baseFareFromDistanceKmWithPricing,
  totalFareFromBaseAndSeatsWithPricing,
} from '../lib/pricing/segment-fare';
import { saveTripRequest, cancelTripRequestsForPassengerFavoriteSlot } from '../rides/api';

type IonName = ComponentProps<typeof Ionicons>['name'];

/**
 * Modal: combinaciones origen/destino por iconos; el slot se resuelve contra `FAVORITE_PRESETS` (ej. Casa→Gym).
 */
const MODAL_ORIGIN_ICONS: IonName[] = [
  'home-outline',
  'car-outline',
  'bus-outline',
  'walk-outline',
  'cafe-outline',
  'navigate-outline',
  'location-outline',
  'train-outline',
];

const MODAL_DEST_ICONS: IonName[] = [
  'briefcase-outline',
  'school-outline',
  'library-outline',
  'business-outline',
  'barbell-outline',
  'airplane-outline',
  'medical-outline',
  'cart-outline',
  'restaurant-outline',
];

function FavoritePairIcons({
  slot,
  iconSize = 22,
  arrowSize = 18,
}: {
  slot: PassengerFavoriteSlot;
  iconSize?: number;
  arrowSize?: number;
}) {
  const preset = getFavoritePreset(slot);
  const from = (preset?.from ?? 'git-network-outline') as IonName;
  const to = (preset?.to ?? 'location-outline') as IonName;
  return (
    <View style={styles.pairIconRow}>
      <Ionicons name={from} size={iconSize} color="#14532d" />
      <Ionicons name="arrow-forward" size={arrowSize} color="#6b7280" style={styles.pairArrow} />
      <Ionicons name={to} size={iconSize} color="#14532d" />
    </View>
  );
}

type HomeTabNav = BottomTabNavigationProp<MainTabParamList, 'Home'>;
type ParentNav = { navigate: (name: string, params?: object) => void };
const HOME_FIXED_SLOTS: PassengerFavoriteSlot[] = ['home_to_work', 'work_to_home'];

/** Inicio: siempre Casa↔Trabajo; debajo, otros presets que ya tengan datos guardados. */
function listHomeFavoriteSlotsToShow(
  favorites: Partial<Record<string, PassengerFavoriteSnapshot | undefined>>
): PassengerFavoriteSlot[] {
  const slots: PassengerFavoriteSlot[] = [...HOME_FIXED_SLOTS];
  const seen = new Set<string>(HOME_FIXED_SLOTS);
  for (const id of FAVORITE_PRESET_IDS) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (favoriteHasConfig(favorites[id])) slots.push(id);
  }
  return slots;
}

function favoriteHasConfig(snap: PassengerFavoriteSnapshot | undefined): boolean {
  if (!snap) return false;
  if (snap.origin.trim() && snap.destination.trim()) return true;
  return (
    snap.originLat != null &&
    snap.originLng != null &&
    snap.destinationLat != null &&
    snap.destinationLng != null
  );
}

function isScheduleDailySnap(snap: PassengerFavoriteSnapshot): boolean {
  const v = snap.scheduleDaily as unknown;
  if (v === true) return true;
  if (typeof v === 'string' && v.toLowerCase() === 'true') return true;
  if (v === 1) return true;
  return false;
}

function scheduleLabel(snap: PassengerFavoriteSnapshot | undefined): string {
  if (!snap) return 'Sin configurar';
  const baseDate = (snap.scheduledDateYmd ?? snap.date ?? '').trim();
  const pickupHm = (snap.scheduledTimeHm ?? snap.fromTime ?? '').trim() || '08:00';
  const arrivalHm = snap.scheduledArrivalTimeHm?.trim();
  if (isScheduleDailySnap(snap)) {
    const nextIso = snap.nextTriggerAtIso?.trim();
    const nextText = nextIso
      ? new Date(nextIso).toLocaleDateString('es-PY', {
          day: '2-digit',
          month: '2-digit',
        })
      : 'proximo dia';
    const maskLabel = scheduleWeekdayMaskLabelEs(snap.scheduleWeekdayMask);
    const daysPart =
      coerceScheduleWeekdayMask(snap.scheduleWeekdayMask) === 127 ? '' : ` · ${maskLabel}`;
    const timePart = arrivalHm ? `llegada ${arrivalHm} · salida ${pickupHm}` : pickupHm;
    return `Diario ${timePart} · prox ${nextText}${daysPart}`;
  }
  if (arrivalHm) {
    return `Fecha ${baseDate || '--'} · llegada ${arrivalHm} (recogida ${pickupHm})`;
  }
  return `Fecha ${baseDate || '--'} · ${pickupHm}`;
}

function toYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatHmFromDate(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function addMinutesToHmLocal(dateYmd: string, hm: string, addMin: number): string | null {
  const t = parseLocalYmdHm(dateYmd, hm);
  if (!t) return null;
  return formatHmFromDate(new Date(t.getTime() + addMin * 60_000));
}

function subtractMinutesFromHmLocal(dateYmd: string, hm: string, subMin: number): string | null {
  const t = parseLocalYmdHm(dateYmd, hm);
  if (!t) return null;
  return formatHmFromDate(new Date(t.getTime() - subMin * 60_000));
}

function normalizeHmForTripRequest(hm: string): string {
  const m = hm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '08:00';
  const hh = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const mm = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

const HOME_FALLBACK_PRICING: EffectivePricing = {
  minFarePyg: 7140,
  pygPerKm: 2780,
  roundTo: 100,
  blockSize: 4,
  blockMultiplier: 1.5,
  driverFeePercentOfCollected: 10,
  pricingSettingsId: null,
};

export function HomeScreen() {
  const navigation = useNavigation<HomeTabNav>();
  const { session } = useAuth();
  const role = session?.role;
  const flavor = getAppFlavor();
  const isPassengerFlavor = flavor !== 'driver';
  const parentNav = navigation.getParent() as ParentNav | undefined;
  const userId = session?.id ?? '';

  const [favorites, setFavorites] = useState<Partial<Record<PassengerFavoriteSlot, PassengerFavoriteSnapshot>>>({});
  const [addFavoriteOpen, setAddFavoriteOpen] = useState(false);
  const [homeShortcutsVisible, setHomeShortcutsVisible] = useState(true);
  const [favoritesTitle, setFavoritesTitle] = useState(DEFAULT_PASSENGER_HOME_FAVORITES_TITLE);
  const [favoritesSubtitle, setFavoritesSubtitle] = useState(DEFAULT_PASSENGER_HOME_FAVORITES_SUBTITLE);
  const [fromIconIndex, setFromIconIndex] = useState(0);
  const [toIconIndex, setToIconIndex] = useState(0);

  /** Activar favorito desde Inicio: confirmar fecha/hora (≥4 h) antes de prender el switch. */
  const [activateOpen, setActivateOpen] = useState(false);
  const [activateSlot, setActivateSlot] = useState<PassengerFavoriteSlot | null>(null);
  const [activateSnap, setActivateSnap] = useState<PassengerFavoriteSnapshot | null>(null);
  const [activateModalDate, setActivateModalDate] = useState('');
  const [activateModalHm, setActivateModalHm] = useState('');
  const [activateModalShowDate, setActivateModalShowDate] = useState(false);
  const [activateModalShowTime, setActivateModalShowTime] = useState(false);
  /** Duración origen→destino (min) vía `/api/route/polyline`; null = sin ruta o aún cargando. */
  const [activateRouteMinutes, setActivateRouteMinutes] = useState<number | null>(null);
  /** `fetchRoute` en segundo plano: el modal abre al toque y no espera la red. */
  const [activateRouteLoading, setActivateRouteLoading] = useState(false);
  const activateRouteRequestIdRef = useRef(0);
  /** Evita doble apertura del modal al tocar rápido el switch de la fila. */
  const activateModalSessionRef = useRef(false);
  /** Evita doble envío de “Activar” mientras corre guardado + red. */
  const confirmActivateBusyRef = useRef(false);
  const [activateSubmitting, setActivateSubmitting] = useState(false);
  const [favoriteCostBySlot, setFavoriteCostBySlot] = useState<
    Partial<Record<PassengerFavoriteSlot, { perSeatGs: number; distanceKm: number } | null>>
  >({});

  const homeFavoriteSlots = useMemo(() => listHomeFavoriteSlotsToShow(favorites), [favorites]);
  const selectedFromIcon = (MODAL_ORIGIN_ICONS[fromIconIndex] ?? MODAL_ORIGIN_ICONS[0]) as string;
  const selectedToIcon = (MODAL_DEST_ICONS[toIconIndex] ?? MODAL_DEST_ICONS[0]) as string;

  const refreshFavorites = useCallback(() => {
    if (!userId) {
      setFavorites({});
      return;
    }
    void loadPassengerFavorites(userId).then((store) => {
      setFavorites(store);
      void pushPassengerHomeMapShortcuts(store);
    });
  }, [userId]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active' && userId && isPassengerFlavor) {
        refreshFavorites();
      }
    });
    return () => sub.remove();
  }, [userId, isPassengerFlavor, refreshFavorites]);

  useFocusEffect(
    useCallback(() => {
      refreshFavorites();
    }, [refreshFavorites])
  );

  useEffect(() => {
    if (!session || !isPassengerFlavor) {
      setFavoriteCostBySlot({});
      return;
    }
    let cancelled = false;

    void (async () => {
      const pricingSettings = await loadActivePricingSettings();
      const pricing = pricingSettings ? computeEffectivePricing(pricingSettings) : HOME_FALLBACK_PRICING;
      const slots = homeFavoriteSlots;
      const nextCosts: Partial<
        Record<PassengerFavoriteSlot, { perSeatGs: number; distanceKm: number } | null>
      > = {};

      for (const slot of slots) {
        if (cancelled) return;
        const snap = favorites[slot];
        if (
          !snap ||
          snap.rideKind === 'long_distance' ||
          snap.originLat == null ||
          snap.originLng == null ||
          snap.destinationLat == null ||
          snap.destinationLng == null
        ) {
          nextCosts[slot] = null;
          continue;
        }

        const straightKm =
          distanceMeters(
            { lat: snap.originLat, lng: snap.originLng },
            { lat: snap.destinationLat, lng: snap.destinationLng }
          ) / 1000;
        const route = await fetchRoute(
          { lat: snap.originLat, lng: snap.originLng },
          { lat: snap.destinationLat, lng: snap.destinationLng },
          []
        );
        if (cancelled) return;

        const routeKm = Number(route.distanceKm ?? 0);
        const fromRoute = Number.isFinite(routeKm) && routeKm > 0 && !route.error && !route.aborted;
        const distanceKm = fromRoute ? routeKm : straightKm * 1.2;
        if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
          nextCosts[slot] = null;
          continue;
        }

        const baseFare = baseFareFromDistanceKmWithPricing(distanceKm, pricing);
        const totalFare = totalFareFromBaseAndSeatsWithPricing(baseFare, 1, pricing);
        nextCosts[slot] = {
          perSeatGs: Math.max(0, Math.round(totalFare)),
          distanceKm,
        };
      }
      if (!cancelled) setFavoriteCostBySlot(nextCosts);
    })();

    return () => {
      cancelled = true;
    };
  }, [session, isPassengerFlavor, homeFavoriteSlots, favorites]);

  useFocusEffect(
    useCallback(() => {
      if (!session || !isPassengerFlavor) return;
      let cancelled = false;
      void (async () => {
        const [visible, copy] = await Promise.all([
          fetchPassengerHomeShortcutsVisible(),
          fetchPassengerHomeFavoritesCopy(),
        ]);
        if (!cancelled) {
          setHomeShortcutsVisible(visible);
          setFavoritesTitle(copy.title);
          setFavoritesSubtitle(copy.subtitle);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [session, isPassengerFlavor])
  );

  const goFavorite = useCallback(
    (slot: PassengerFavoriteSlot) => {
      if (!session) {
        Alert.alert('Inicia sesion', 'Necesitas una cuenta para guardar favoritos.');
        return;
      }
      setAddFavoriteOpen(false);
      parentNav?.navigate('SearchPublishedRides', { favoriteSlot: slot });
    },
    [parentNav, session]
  );

  const openAddFavorite = useCallback(() => {
    if (!session) {
      Alert.alert('Inicia sesion', 'Necesitas una cuenta para guardar favoritos.');
      return;
    }
    setFromIconIndex(0);
    setToIconIndex(0);
    setAddFavoriteOpen(true);
  }, [session]);

  const rotateOriginIndex = useCallback((index: number, delta: number) => {
    const len = MODAL_ORIGIN_ICONS.length;
    if (!len) return 0;
    return (index + delta + len) % len;
  }, []);

  const rotateDestIndex = useCallback((index: number, delta: number) => {
    const len = MODAL_DEST_ICONS.length;
    if (!len) return 0;
    return (index + delta + len) % len;
  }, []);

  const saveSelectedFavorite = useCallback(() => {
    if (selectedFromIcon === selectedToIcon) {
      Alert.alert('Elegí dos iconos distintos', 'El origen y el destino no pueden ser el mismo icono.');
      return;
    }
    const slot = findFavoritePresetIdByIcons(selectedFromIcon, selectedToIcon);
    if (slot) {
      goFavorite(slot);
      return;
    }
    Alert.alert(
      'Combinación no disponible',
      'Esa pareja de iconos no coincide con un trayecto guardable. Probá otra combinación (por ejemplo Casa + Gym, o Trabajo + Casa).'
    );
  }, [goFavorite, selectedFromIcon, selectedToIcon]);

  const cancelActivateFavorite = useCallback(() => {
    activateRouteRequestIdRef.current += 1;
    activateModalSessionRef.current = false;
    setActivateOpen(false);
    setActivateSlot(null);
    setActivateSnap(null);
    setActivateRouteMinutes(null);
    setActivateRouteLoading(false);
    setActivateModalShowDate(false);
    setActivateModalShowTime(false);
    setActivateSubmitting(false);
    confirmActivateBusyRef.current = false;
  }, []);

  const setFavoriteDisabled = useCallback(
    async (slot: PassengerFavoriteSlot) => {
      if (!session || !userId) return;
      if (activateOpen && activateSlot === slot) {
        cancelActivateFavorite();
      }
      const snap = await getPassengerFavorite(userId, slot);
      if (!snap) return;
      await upsertPassengerFavorite(userId, slot, {
        date: snap.date,
        fromTime: snap.fromTime,
        routeNameQuery: snap.routeNameQuery,
        origin: snap.origin,
        destination: snap.destination,
        originLat: snap.originLat,
        originLng: snap.originLng,
        destinationLat: snap.destinationLat,
        destinationLng: snap.destinationLng,
        rideKind: snap.rideKind,
        enabled: false,
        scheduleDaily: Boolean(snap.scheduleDaily),
        scheduleWeekdayMask: snap.scheduleWeekdayMask,
        scheduledDateYmd: snap.scheduledDateYmd ?? snap.date,
        scheduledTimeHm: snap.scheduledTimeHm ?? snap.fromTime,
        scheduledArrivalTimeHm: snap.scheduledArrivalTimeHm,
        nextTriggerAtIso:
          computeNextTriggerIso(
            new Date(),
            snap.scheduledDateYmd ?? snap.date,
            snap.scheduledTimeHm ?? snap.fromTime,
            Boolean(snap.scheduleDaily),
            snap.scheduleWeekdayMask
          ) ?? undefined,
      });
      await cancelTripRequestsForPassengerFavoriteSlot(userId, slot);
      const all = await loadPassengerFavorites(userId);
      setFavorites(all);
      void pushPassengerHomeMapShortcuts(all);
    },
    [session, userId, activateOpen, activateSlot, cancelActivateFavorite]
  );

  const openActivateFavoriteModal = useCallback(
    async (slot: PassengerFavoriteSlot) => {
      if (!session || !userId) return;
      if (activateModalSessionRef.current) return;
      activateModalSessionRef.current = true;
      let opened = false;
      try {
      const snap = await getPassengerFavorite(userId, slot);
      if (!snap || !favoriteHasConfig(snap)) {
        activateModalSessionRef.current = false;
        Alert.alert('Primero configuralo', `Completa ${favoritePairLabel(slot)} y luego activa el switch.`);
        goFavorite(slot);
        return;
      }

      const requestId = ++activateRouteRequestIdRef.current;
      const pickupHm = (snap.scheduledTimeHm ?? snap.fromTime ?? '08:00').trim() || '08:00';
      const storedArrivalHm = snap.scheduledArrivalTimeHm?.trim();
      let d = (snap.scheduledDateYmd ?? snap.date ?? toYmdLocal(new Date())).trim();
      for (let i = 0; i < 400; i++) {
        if (isPickupAtLeastLeadAhead(d, pickupHm, MIN_BOOKING_LEAD_MS)) break;
        d = addDaysToYmd(d, 1);
      }

      const hasCoords =
        snap.originLat != null &&
        snap.originLng != null &&
        snap.destinationLat != null &&
        snap.destinationLng != null;
      setActivateSnap(snap);
      setActivateSlot(slot);
      setActivateModalDate(d);
      /** Con ruta: modal en hora de llegada si el favorito se guardó en modo llegada. Sin coords no podemos restar duración → mostrar recogida. */
      setActivateModalHm(hasCoords && storedArrivalHm ? storedArrivalHm : pickupHm);
      setActivateRouteMinutes(null);
      setActivateModalShowDate(false);
      setActivateModalShowTime(false);
      setActivateRouteLoading(hasCoords);
      setActivateOpen(true);
      opened = true;

      if (!hasCoords) {
        setActivateRouteLoading(false);
        return;
      }

      void (async () => {
        const route = await fetchRoute(
          { lat: snap.originLat!, lng: snap.originLng! },
          { lat: snap.destinationLat!, lng: snap.destinationLng! },
          []
        );
        if (requestId !== activateRouteRequestIdRef.current) return;
        setActivateRouteLoading(false);
        if (
          route.durationMinutes == null ||
          route.error ||
          route.aborted ||
          !Number.isFinite(route.durationMinutes)
        ) {
          if (storedArrivalHm) setActivateModalHm(pickupHm);
          return;
        }
        const routeMinutes = Math.max(1, Math.round(route.durationMinutes));
        let dWork = d;
        const arrivalHm = storedArrivalHm
          ? storedArrivalHm
          : addMinutesToHmLocal(dWork, pickupHm, routeMinutes) ??
            addMinutesToHmLocal(dWork, '08:00', routeMinutes) ??
            '09:00';
        for (let i = 0; i < 400; i++) {
          const pu = subtractMinutesFromHmLocal(dWork, arrivalHm, routeMinutes);
          if (pu && isPickupAtLeastLeadAhead(dWork, pu, MIN_BOOKING_LEAD_MS)) break;
          dWork = addDaysToYmd(dWork, 1);
        }
        if (requestId !== activateRouteRequestIdRef.current) return;
        setActivateRouteMinutes(routeMinutes);
        setActivateModalDate(dWork);
        setActivateModalHm(arrivalHm);
      })();
      } catch {
        activateModalSessionRef.current = false;
      } finally {
        if (!opened) activateModalSessionRef.current = false;
      }
    },
    [session, userId, goFavorite]
  );

  const confirmActivateFavorite = useCallback(async () => {
    if (!session || !userId || !activateSlot || !activateSnap) return;
    if (confirmActivateBusyRef.current) return;
    confirmActivateBusyRef.current = true;
    setActivateSubmitting(true);
    try {
      const d = activateModalDate.trim();
      const hm = activateModalHm.trim();
      if (!d || !hm) {
        Alert.alert('Datos incompletos', 'Elegí fecha y hora.');
        return;
      }

      const dur = activateRouteMinutes;
      let pickupHm: string;
      if (dur != null) {
        const pu = subtractMinutesFromHmLocal(d, hm, dur);
        if (!pu) {
          Alert.alert('Datos incompletos', 'La hora de llegada no es válida para esa fecha.');
          return;
        }
        pickupHm = pu;
        if (!isPickupAtLeastLeadAhead(d, pickupHm, MIN_BOOKING_LEAD_MS)) {
          Alert.alert(
            'Anticipación mínima',
            'La salida estimada (recogida) tiene que quedar al menos 4 horas desde ahora. Elegí una llegada más tarde u otra fecha.'
          );
          return;
        }
      } else {
        pickupHm = hm;
        if (!isPickupAtLeastLeadAhead(d, pickupHm, MIN_BOOKING_LEAD_MS)) {
          Alert.alert(
            'Anticipación mínima',
            'Elegí fecha y hora con al menos 4 horas desde ahora (hora de este dispositivo).'
          );
          return;
        }
      }

      const snap = activateSnap;
      await upsertPassengerFavorite(userId, activateSlot, {
        date: d,
        fromTime: pickupHm,
        routeNameQuery: snap.routeNameQuery,
        origin: snap.origin,
        destination: snap.destination,
        originLat: snap.originLat,
        originLng: snap.originLng,
        destinationLat: snap.destinationLat,
        destinationLng: snap.destinationLng,
        rideKind: snap.rideKind,
        enabled: true,
        scheduleDaily: Boolean(snap.scheduleDaily),
        scheduleWeekdayMask: snap.scheduleWeekdayMask,
        scheduledDateYmd: d,
        scheduledTimeHm: pickupHm,
        scheduledArrivalTimeHm: dur != null ? hm.trim() : undefined,
        nextTriggerAtIso:
          computeNextTriggerIso(new Date(), d, pickupHm, Boolean(snap.scheduleDaily), snap.scheduleWeekdayMask) ??
          undefined,
      });
      const all = await loadPassengerFavorites(userId);
      setFavorites(all);
      void pushPassengerHomeMapShortcuts(all);
      const shouldRegisterGroupedRequest =
        snap.rideKind !== 'long_distance' &&
        snap.originLat != null &&
        snap.originLng != null &&
        snap.destinationLat != null &&
        snap.destinationLng != null;
      if (shouldRegisterGroupedRequest) {
        const token = session?.access_token?.trim();
        if (!token) {
          Alert.alert('Solicitud de viaje', 'No se pudo registrar la solicitud: sesión inválida.');
        } else {
          const route = await fetchRoute(
            { lat: snap.originLat!, lng: snap.originLng! },
            { lat: snap.destinationLat!, lng: snap.destinationLng! },
            []
          );
          const poly = route.polyline && route.polyline.length >= 2 ? route.polyline : null;
          const baseTripArgs = {
            accessToken: token,
            userId,
            originLat: snap.originLat!,
            originLng: snap.originLng!,
            originLabel: (snap.origin.trim() || 'Origen').slice(0, 500),
            destinationLat: snap.destinationLat!,
            destinationLng: snap.destinationLng!,
            destinationLabel: (snap.destination.trim() || 'Destino').slice(0, 500),
            requestedDate: d,
            requestedTime: normalizeHmForTripRequest(pickupHm),
            seats: 1,
            routePolyline: poly,
            routeLengthKm: route.distanceKm ?? null,
            pricingKind: 'internal' as const,
            internalQuoteAcknowledged: true,
            passengerFavoriteSlot: activateSlot,
          };
          let tripRes = await saveTripRequest(baseTripArgs);
          if (!tripRes.ok && tripRes.code === 'GROUPED_FAVORITE_EXISTS') {
            const leaveGroup = await new Promise<boolean>((resolve) => {
              Alert.alert(
                'Ya está en un grupo',
                tripRes.error ??
                  'Esta solicitud ya figuraba en un grupo de demanda. Si continuás, salís de ese grupo y se registra una solicitud nueva.',
                [
                  { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
                  { text: 'Salir del grupo y registrar', onPress: () => resolve(true) },
                ],
                { cancelable: true, onDismiss: () => resolve(false) }
              );
            });
            if (leaveGroup) {
              tripRes = await saveTripRequest({ ...baseTripArgs, confirmLeaveGroupedFavorite: true });
            }
          }
          if (!tripRes.ok) {
            Alert.alert('Solicitud de viaje', tripRes.error || 'No se pudo registrar la solicitud pendiente.');
          }
        }
      }
      cancelActivateFavorite();
    } finally {
      confirmActivateBusyRef.current = false;
      setActivateSubmitting(false);
    }
  }, [
    session,
    userId,
    activateSlot,
    activateSnap,
    activateModalDate,
    activateModalHm,
    activateRouteMinutes,
    cancelActivateFavorite,
  ]);

  const deleteFavorite = useCallback(
    (slot: PassengerFavoriteSlot) => {
      if (!session || !userId) return;
      Alert.alert('Eliminar favorito', `Se eliminara ${favoritePairLabel(slot)} de Inicio.`, [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await removePassengerFavorite(userId, slot);
              const all = await loadPassengerFavorites(userId);
              setFavorites(all);
              void pushPassengerHomeMapShortcuts(all);
            })();
          },
        },
      ]);
    },
    [session, userId]
  );

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.card}>
        {role === 'driver_pending' && (
          <View style={styles.bannerWarning}>
            <Text style={styles.bannerText}>
              Tu cuenta de conductor esta en revision. Cuando sea aprobada podras publicar viajes.
            </Text>
          </View>
        )}
        {role === 'admin' && (
          <View style={styles.bannerInfo}>
            <Text style={styles.bannerText}>Para administrar precios, facturacion y metricas usa el panel web.</Text>
          </View>
        )}

        {isPassengerFlavor && session ? (
          <>
            <Text style={styles.welcomePassenger}>
              {favoritesTitle}
            </Text>
            <Text style={styles.subLead}>{favoritesSubtitle}</Text>

            <View style={styles.favoritesBox}>
              <TouchableOpacity
                style={styles.favoritesPrimaryBtn}
                onPress={openAddFavorite}
                accessibilityRole="button"
                accessibilityLabel="Programa tu próximo viaje"
              >
                <Ionicons name="add-circle-outline" size={22} color="#fff" style={styles.favoritesPrimaryIcon} />
                <Text style={styles.favoritesPrimaryBtnText}>Programa tu próximo viaje</Text>
              </TouchableOpacity>

              <ScrollView
                style={styles.favoriteStackScroll}
                contentContainerStyle={styles.favoriteStackContent}
                nestedScrollEnabled
                showsVerticalScrollIndicator
              >
                {homeFavoriteSlots.map((slot) => {
                  const snap = favorites[slot];
                  const enabled = isFavoriteEnabled(snap);
                  const switchShowsOn =
                    enabled || (activateOpen && activateSlot === slot);
                  const configured = favoriteHasConfig(snap);
                  return (
                    <TouchableOpacity
                      key={slot}
                      style={styles.favoriteRow}
                      onPress={() => goFavorite(slot)}
                      accessibilityRole="button"
                      accessibilityLabel={`Favorito ${favoritePairLabel(slot)}`}
                    >
                      <TouchableOpacity
                        style={styles.favoriteDeleteBtn}
                        onPress={() => deleteFavorite(slot)}
                        accessibilityRole="button"
                        accessibilityLabel={`Eliminar ${favoritePairLabel(slot)}`}
                      >
                        <Ionicons name="close" size={12} color="#b91c1c" />
                      </TouchableOpacity>
                      <View style={styles.favoriteRowLeft}>
                        <View style={styles.favoriteRowTitleRow}>
                          <FavoritePairIcons slot={slot} iconSize={20} arrowSize={16} />
                          {configured && enabled ? (
                            <View style={styles.favoriteActiveBadge}>
                              <Text style={styles.favoriteActiveBadgeText}>Activo</Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={styles.favoriteRowLabel}>{favoritePairLabel(slot)}</Text>
                        <Text style={styles.favoriteRowTime}>{scheduleLabel(snap)}</Text>
                        {snap?.rideKind === 'long_distance' ? (
                          <Text style={styles.favoriteRowCostMuted}>Costo: se negocia con conductor</Text>
                        ) : favoriteCostBySlot[slot] != null ? (
                          <Text style={styles.favoriteRowCost}>
                            Costo estimado: {Number(favoriteCostBySlot[slot]?.perSeatGs ?? 0).toLocaleString('es-PY')} Gs
                          </Text>
                        ) : (
                          <Text style={styles.favoriteRowCostMuted}>Costo estimado: no disponible</Text>
                        )}
                      </View>
                      <View
                        style={styles.favoriteRowRight}
                        onStartShouldSetResponder={() => true}
                        onTouchEnd={(e) => e.stopPropagation()}
                      >
                        <Switch
                          value={switchShowsOn}
                          onValueChange={(v) => {
                            if (!v) {
                              void setFavoriteDisabled(slot);
                              return;
                            }
                            void openActivateFavoriteModal(slot);
                          }}
                          trackColor={{ false: '#d1d5db', true: '#86efac' }}
                          thumbColor={switchShowsOn ? '#166534' : '#f3f4f6'}
                        />
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            <Modal
              visible={addFavoriteOpen}
              animationType="slide"
              transparent
              onRequestClose={() => setAddFavoriteOpen(false)}
            >
              <View style={styles.modalRoot}>
                <Pressable style={styles.modalBackdrop} onPress={() => setAddFavoriteOpen(false)} />
                <SafeAreaView style={styles.modalSheet} edges={['bottom']}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>Elige el trayecto a guardar</Text>
                    <TouchableOpacity onPress={() => setAddFavoriteOpen(false)} hitSlop={12} accessibilityRole="button">
                      <Text style={styles.modalClose}>Cerrar</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.modalHint}>
                    Elegí origen y destino con las flechas: se abre el favorito que coincida con el par de iconos
                    (Casa→Gym, Trabajo→Casa, Casa→Trabajo, etc.).
                  </Text>
                  <View style={styles.modalPickerWrap}>
                    <View style={styles.modalPickerRow}>
                      <View style={styles.modalSelectorColumn}>
                        <TouchableOpacity
                          style={styles.modalArrowBtn}
                          onPress={() => setFromIconIndex((v) => rotateOriginIndex(v, -1))}
                          accessibilityRole="button"
                          accessibilityLabel="Icono origen anterior"
                        >
                          <Ionicons name="chevron-up" size={22} color="#14532d" />
                        </TouchableOpacity>
                        <View style={styles.modalIconBox}>
                          <Ionicons name={selectedFromIcon as IonName} size={30} color="#14532d" />
                        </View>
                        <TouchableOpacity
                          style={styles.modalArrowBtn}
                          onPress={() => setFromIconIndex((v) => rotateOriginIndex(v, 1))}
                          accessibilityRole="button"
                          accessibilityLabel="Icono origen siguiente"
                        >
                          <Ionicons name="chevron-down" size={22} color="#14532d" />
                        </TouchableOpacity>
                      </View>
                      <View style={styles.modalMiddleArrowBadge}>
                        <Ionicons name="arrow-forward" size={30} color="#166534" style={styles.modalMiddleArrow} />
                      </View>

                      <View style={styles.modalSelectorColumn}>
                        <TouchableOpacity
                          style={styles.modalArrowBtn}
                          onPress={() => setToIconIndex((v) => rotateDestIndex(v, -1))}
                          accessibilityRole="button"
                          accessibilityLabel="Icono destino anterior"
                        >
                          <Ionicons name="chevron-up" size={22} color="#14532d" />
                        </TouchableOpacity>
                        <View style={styles.modalIconBox}>
                          <Ionicons name={selectedToIcon as IonName} size={30} color="#14532d" />
                        </View>
                        <TouchableOpacity
                          style={styles.modalArrowBtn}
                          onPress={() => setToIconIndex((v) => rotateDestIndex(v, 1))}
                          accessibilityRole="button"
                          accessibilityLabel="Icono destino siguiente"
                        >
                          <Ionicons name="chevron-down" size={22} color="#14532d" />
                        </TouchableOpacity>
                      </View>
                    </View>
                    <Text style={styles.modalCounterText}>
                      {`Origen ${fromIconIndex + 1}/${MODAL_ORIGIN_ICONS.length} · Destino ${toIconIndex + 1}/${MODAL_DEST_ICONS.length}`}
                    </Text>
                    <TouchableOpacity
                      style={styles.modalSaveBtn}
                      onPress={saveSelectedFavorite}
                      accessibilityRole="button"
                      accessibilityLabel="Guardar este trayecto favorito"
                    >
                      <Text style={styles.modalSaveBtnText}>Usar este trayecto</Text>
                    </TouchableOpacity>
                  </View>
                </SafeAreaView>
              </View>
            </Modal>

            <Modal
              visible={activateOpen}
              transparent
              animationType="fade"
              onRequestClose={cancelActivateFavorite}
            >
              <Pressable style={styles.activateModalOverlay} onPress={cancelActivateFavorite}>
                <Pressable style={styles.activateModalCard} onPress={(e) => e.stopPropagation()}>
                  <Text style={styles.activateModalTitle}>Activar favorito</Text>
                  <Text style={styles.activateModalSubtitle}>
                    Confirmá la fecha y la{' '}
                    <Text style={styles.activateModalEm}>hora estimada de llegada</Text> al destino para{' '}
                    {activateSlot ? (
                      <Text style={styles.activateModalEm}>{favoritePairLabel(activateSlot)}</Text>
                    ) : (
                      'este trayecto'
                    )}
                    .
                    {activateRouteMinutes == null && !activateRouteLoading ? (
                      <>
                        {'\n\n'}
                        Sin duración por mapa: la hora que elijas se guarda como salida o recogida (marcá origen y
                        destino en el mapa al editar el favorito para estimar llegada).
                      </>
                    ) : null}
                  </Text>
                  {activateRouteLoading ? (
                    <View style={styles.activateModalLoadingRow}>
                      <ActivityIndicator size="small" color="#166534" />
                      <Text style={styles.activateModalLoadingText}>Calculando la ruta en el mapa…</Text>
                    </View>
                  ) : null}
                  {activateSlot ? (
                    <View style={styles.activateModalIcons} accessibilityRole="image">
                      <FavoritePairIcons slot={activateSlot} iconSize={36} arrowSize={22} />
                    </View>
                  ) : null}
                  <Text style={styles.activateModalFieldLabel}>Fecha</Text>
                  <TouchableOpacity
                    style={styles.activateModalPicker}
                    onPress={() => {
                      setActivateModalShowTime(false);
                      setActivateModalShowDate(true);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Elegir fecha de activación del favorito"
                  >
                    <Text style={styles.activateModalPickerValue}>{activateModalDate.trim() || '—'}</Text>
                  </TouchableOpacity>
                  {activateModalShowDate ? (
                    <DateTimePicker
                      value={new Date((activateModalDate.trim() || toYmdLocal(new Date())) + 'T12:00:00')}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      onChange={(ev, picked) => {
                        if (ev.type === 'dismissed') {
                          setActivateModalShowDate(false);
                          return;
                        }
                        if (Platform.OS !== 'ios') setActivateModalShowDate(false);
                        if (picked) setActivateModalDate(toYmdLocal(picked));
                      }}
                    />
                  ) : null}
                  <Text style={styles.activateModalFieldLabel}>Hora estimada de llegada</Text>
                  <TouchableOpacity
                    style={styles.activateModalPicker}
                    onPress={() => {
                      setActivateModalShowDate(false);
                      setActivateModalShowTime(true);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Elegir hora estimada de llegada al destino"
                  >
                    <Text style={styles.activateModalPickerValue}>{activateModalHm.trim() || '—'}</Text>
                  </TouchableOpacity>
                  {activateModalShowTime ? (
                    <DateTimePicker
                      value={(() => {
                        const hm = activateModalHm.trim() || '08:00';
                        const [h, m] = hm.split(':').map((x) => parseInt(x, 10));
                        const d = new Date();
                        d.setHours(Number.isFinite(h) ? h : 8, Number.isFinite(m) ? m : 0, 0, 0);
                        return d;
                      })()}
                      mode="time"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      onChange={(ev, picked) => {
                        if (ev.type === 'dismissed') {
                          setActivateModalShowTime(false);
                          return;
                        }
                        if (Platform.OS !== 'ios') setActivateModalShowTime(false);
                        if (picked) {
                          setActivateModalHm(
                            `${String(picked.getHours()).padStart(2, '0')}:${String(picked.getMinutes()).padStart(2, '0')}`
                          );
                        }
                      }}
                    />
                  ) : null}
                  {activateRouteLoading ? (
                    <Text style={styles.activateModalHint}>
                      Mientras tanto la hora mostrada es la de salida o recogida guardada; al terminar el cálculo se
                      ajusta a la llegada estimada.
                    </Text>
                  ) : activateRouteMinutes != null ? (
                    <Text style={styles.activateModalHint}>
                      La salida o recogida se calcula con la ruta del mapa (~{activateRouteMinutes} min). Tiene que
                      quedar al menos 4 horas desde ahora. Podés cambiar fecha y hora de llegada antes de confirmar.
                    </Text>
                  ) : (
                    <Text style={styles.activateModalHint}>
                      Si la fecha guardada ya pasó o queda a menos de 4 horas, te sugerimos el próximo día posible.
                      Podés cambiar fecha y hora acá antes de confirmar.
                    </Text>
                  )}
                  {activateSnap &&
                  activateSnap.rideKind !== 'long_distance' &&
                  activateSnap.originLat != null &&
                  activateSnap.originLng != null &&
                  activateSnap.destinationLat != null &&
                  activateSnap.destinationLng != null ? (
                    <Text style={styles.activateModalGroupedHint}>
                      Al tocar Activar también se crea o actualiza tu solicitud en Mis solicitudes (demanda agrupada).
                    </Text>
                  ) : activateSnap && activateSnap.rideKind === 'long_distance' ? (
                    <Text style={styles.activateModalGroupedHint}>
                      Este favorito es larga distancia: no se registra solicitud automática en demanda agrupada.
                    </Text>
                  ) : activateSnap ? (
                    <Text style={styles.activateModalGroupedHint}>
                      Marcá origen y destino en el mapa al editar el favorito para poder registrar la solicitud en Mis
                      solicitudes.
                    </Text>
                  ) : null}
                  <View style={styles.activateModalActions}>
                    <TouchableOpacity
                      style={[styles.activateModalBtn, styles.activateModalBtnGhost]}
                      onPress={cancelActivateFavorite}
                      disabled={activateSubmitting}
                      accessibilityRole="button"
                    >
                      <Text style={styles.activateModalBtnGhostText}>Cancelar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.activateModalBtn,
                        styles.activateModalBtnPrimary,
                        activateSubmitting && styles.activateModalBtnPrimaryDisabled,
                      ]}
                      onPress={() => void confirmActivateFavorite()}
                      disabled={activateSubmitting}
                      accessibilityRole="button"
                    >
                      <Text style={styles.activateModalBtnPrimaryText}>
                        {activateSubmitting ? 'Guardando…' : 'Activar'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </Pressable>
              </Pressable>
            </Modal>

            {homeShortcutsVisible ? (
              <>
                <TouchableOpacity
                  style={styles.fakeSearch}
                  onPress={() => parentNav?.navigate('SearchPublishedRides', {})}
                  accessibilityRole="button"
                  accessibilityLabel="Buscar viajes"
                >
                  <Ionicons name="search" size={20} color="#9ca3af" style={styles.fakeSearchIcon} />
                  <Text style={styles.fakeSearchPlaceholder}>A donde queres ir hoy? (Rutas populares, lineas...)</Text>
                </TouchableOpacity>

                <View style={styles.rowTwo}>
                  <TouchableOpacity style={styles.btnMint} onPress={() => parentNav?.navigate('SearchPublishedRides', {})} accessibilityRole="button">
                    <Text style={styles.btnMintText}>Buscar viajes</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btnMint} onPress={() => parentNav?.navigate('MyBookings')} accessibilityRole="button">
                    <Text style={styles.btnMintText}>Mis reservas</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.rowTwo}>
                  <TouchableOpacity style={styles.btnMint} onPress={() => parentNav?.navigate('Messages')} accessibilityRole="button">
                    <View style={styles.btnMintInner}>
                      <Ionicons name="chatbubble-ellipses-outline" size={20} color="#14532d" />
                      <Text style={styles.btnMintText}>Mensajes</Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btnMint} onPress={() => parentNav?.navigate('MyTripRequests')} accessibilityRole="button">
                    <View style={styles.btnMintInner}>
                      <Ionicons name="document-text-outline" size={20} color="#14532d" />
                      <Text style={styles.btnMintText}>Mis solicitudes</Text>
                    </View>
                  </TouchableOpacity>
                </View>
              </>
            ) : null}
          </>
        ) : null}

        {!isPassengerFlavor && session ? (
          <>
            <Text style={styles.welcomePassenger}>Inicio de conductor</Text>
            <Text style={styles.subLead}>
              Gestiona tus viajes publicados y responde solicitudes desde este panel rapido.
            </Text>

            <View style={styles.driverQuickBox}>
              <TouchableOpacity
                style={styles.driverPrimaryBtn}
                onPress={() => parentNav?.navigate('PublishRide')}
                accessibilityRole="button"
                accessibilityLabel="Publicar viaje"
              >
                <Ionicons name="car-sport-outline" size={20} color="#fff" style={styles.driverPrimaryIcon} />
                <Text style={styles.driverPrimaryBtnText}>PUBLICAR VIAJE</Text>
              </TouchableOpacity>

              <View style={styles.rowTwo}>
                <TouchableOpacity
                  style={styles.btnMint}
                  onPress={() => parentNav?.navigate('DriverTripRequests')}
                  accessibilityRole="button"
                >
                  <View style={styles.btnMintInner}>
                    <Ionicons name="document-text-outline" size={20} color="#14532d" />
                    <Text style={styles.btnMintText}>Solicitudes</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.btnMint}
                  onPress={() => parentNav?.navigate('MyPublishedRides')}
                  accessibilityRole="button"
                >
                  <View style={styles.btnMintInner}>
                    <Ionicons name="list-outline" size={20} color="#14532d" />
                    <Text style={styles.btnMintText}>Mis viajes</Text>
                  </View>
                </TouchableOpacity>
              </View>

              <View style={styles.rowTwo}>
                <TouchableOpacity
                  style={styles.btnMint}
                  onPress={() => parentNav?.navigate('Messages')}
                  accessibilityRole="button"
                >
                  <View style={styles.btnMintInner}>
                    <Ionicons name="chatbubble-ellipses-outline" size={20} color="#14532d" />
                    <Text style={styles.btnMintText}>Mensajes</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.btnMint}
                  onPress={() => navigation.navigate('Driver')}
                  accessibilityRole="button"
                >
                  <View style={styles.btnMintInner}>
                    <Ionicons name="speedometer-outline" size={20} color="#14532d" />
                    <Text style={styles.btnMintText}>Panel conductor</Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#f0fdf4' },
  scrollContent: { flexGrow: 1, padding: 20, paddingBottom: 32 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#d1fae5',
  },
  welcomePassenger: { fontSize: 20, fontWeight: '800', color: '#14532d', marginBottom: 8, lineHeight: 26 },
  subLead: { fontSize: 14, color: '#4b5563', lineHeight: 21, marginBottom: 14 },
  bannerWarning: { backgroundColor: '#fef3c7', padding: 12, borderRadius: 8, marginBottom: 16, borderWidth: 1, borderColor: '#f59e0b' },
  bannerInfo: { backgroundColor: '#dbeafe', padding: 12, borderRadius: 8, marginBottom: 16, borderWidth: 1, borderColor: '#3b82f6' },
  bannerText: { fontSize: 14, color: '#1f2937' },
  favoritesBox: { borderWidth: 1, borderColor: '#86efac', borderRadius: 14, padding: 14, marginBottom: 16, backgroundColor: '#f0fdf4' },
  favoritesPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#14532d',
    paddingVertical: 14,
    borderRadius: 10,
    marginBottom: 12,
  },
  favoritesPrimaryIcon: { marginRight: 8 },
  favoritesPrimaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 13, letterSpacing: 0.3 },
  pairIconRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  pairArrow: { marginHorizontal: 3 },
  favoriteRowTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 8,
    flexWrap: 'wrap',
  },
  favoriteActiveBadge: {
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#86efac',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  favoriteActiveBadgeText: { fontSize: 11, fontWeight: '700', color: '#166534' },
  favoriteStackScroll: { maxHeight: 360 },
  favoriteStackContent: { gap: 8, paddingBottom: 4 },
  favoriteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 12,
    backgroundColor: '#fff',
    paddingVertical: 10,
    paddingHorizontal: 10,
    gap: 8,
  },
  favoriteRowLeft: { flex: 1, minWidth: 0 },
  favoriteRowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  favoriteDeleteBtn: {
    position: 'absolute',
    top: 6,
    right: 8,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fff1f2',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  favoriteRowLabel: { fontSize: 13, fontWeight: '700', color: '#14532d', marginTop: 4 },
  favoriteRowTime: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  favoriteRowCost: { fontSize: 12, color: '#166534', marginTop: 2, fontWeight: '700' },
  favoriteRowCostMuted: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '60%', paddingBottom: 8 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#111', flex: 1, paddingRight: 8 },
  modalClose: { fontSize: 16, fontWeight: '600', color: '#166534' },
  modalHint: { fontSize: 13, color: '#6b7280', paddingHorizontal: 16, paddingVertical: 10, lineHeight: 18 },
  modalPickerWrap: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  modalPickerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  modalSelectorColumn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 84,
  },
  modalIconBox: {
    width: 58,
    height: 58,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    backgroundColor: '#f0fdf4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalArrowBtn: {
    width: 40,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalMiddleArrowBadge: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#bbf7d0',
    borderWidth: 1,
    borderColor: '#4ade80',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 34,
  },
  modalMiddleArrow: { marginLeft: 1 },
  modalCounterText: { textAlign: 'center', color: '#94a3b8', fontSize: 12, marginTop: 6, marginBottom: 14 },
  modalSaveBtn: {
    backgroundColor: '#14532d',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  modalSaveBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  fakeSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
    backgroundColor: '#f9fafb',
  },
  fakeSearchIcon: { marginRight: 10 },
  fakeSearchPlaceholder: { flex: 1, fontSize: 14, color: '#9ca3af' },
  rowTwo: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  btnMint: {
    flex: 1,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#86efac',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnMintInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnMintText: { fontSize: 14, fontWeight: '700', color: '#14532d' },
  driverQuickBox: {
    borderWidth: 1,
    borderColor: '#86efac',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    backgroundColor: '#f0fdf4',
  },
  driverPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#14532d',
    paddingVertical: 14,
    borderRadius: 10,
    marginBottom: 12,
  },
  driverPrimaryIcon: { marginRight: 8 },
  driverPrimaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 13, letterSpacing: 0.3 },
  activateModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  activateModalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    maxWidth: 420,
    width: '100%',
    alignSelf: 'center',
  },
  activateModalTitle: { fontSize: 18, fontWeight: '800', color: '#111827', marginBottom: 8 },
  activateModalSubtitle: { fontSize: 14, color: '#4b5563', lineHeight: 20, marginBottom: 12 },
  activateModalEm: { fontWeight: '700', color: '#14532d' },
  activateModalLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  activateModalLoadingText: { fontSize: 13, color: '#4b5563', flex: 1 },
  activateModalIcons: { alignItems: 'center', marginBottom: 16 },
  activateModalFieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 4,
    marginTop: 4,
  },
  activateModalPicker: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 10,
    backgroundColor: '#fff',
  },
  activateModalPickerValue: { fontSize: 16, color: '#111' },
  activateModalHint: {
    fontSize: 12,
    color: '#6b7280',
    lineHeight: 17,
    marginTop: 8,
    marginBottom: 4,
  },
  activateModalGroupedHint: {
    fontSize: 12,
    color: '#4b5563',
    lineHeight: 17,
    marginTop: 10,
    marginBottom: 4,
  },
  activateModalToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 8,
  },
  activateModalToggleTextWrap: { flex: 1, minWidth: 0 },
  activateModalToggleTitle: { fontSize: 13, fontWeight: '700', color: '#14532d' },
  activateModalToggleHint: { fontSize: 12, color: '#6b7280', marginTop: 2, lineHeight: 16 },
  activateModalActions: { flexDirection: 'row', gap: 10, marginTop: 16, justifyContent: 'flex-end' },
  activateModalBtn: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    minWidth: 100,
    alignItems: 'center',
  },
  activateModalBtnGhost: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
  },
  activateModalBtnGhostText: { fontSize: 15, fontWeight: '600', color: '#374151' },
  activateModalBtnPrimary: { backgroundColor: '#166534' },
  activateModalBtnPrimaryDisabled: { opacity: 0.55 },
  activateModalBtnPrimaryText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
