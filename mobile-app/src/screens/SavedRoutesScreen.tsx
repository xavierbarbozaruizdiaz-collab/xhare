/**
 * Pestaña Rutas: favoritos del pasajero (antes en Inicio).
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
  Platform,
  ActivityIndicator,
  Animated,
  Easing,
  AppState,
  type AppStateStatus,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { CompositeNavigationProp, RouteProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import type { MainStackParamList, MainTabParamList } from '../navigation/types';
import { TinyHelpButton } from '../ui/TinyHelpButton';
import { pushPassengerHomeMapShortcuts } from '../backend/passengerHomeMapShortcutSync';
import {
  loadPassengerFavorites,
  getPassengerFavorite,
  upsertPassengerFavorite,
  removePassengerFavorite,
  getFavoritePreset,
  favoritePairLabel,
  isFavoriteEnabled,
  favoriteHasConfig,
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
import { clampDateNotBeforeLocalDay, datePickerDisplay, startOfLocalDay, timePickerDisplay } from '../lib/datePickerUi';
import {
  loadActivePricingSettings,
  computeEffectivePricing,
  type EffectivePricing,
} from '../lib/pricing/runtime-pricing';
import {
  baseFareFromDistanceKmWithPricing,
  totalFareFromBaseAndSeatsWithPricing,
} from '../lib/pricing/segment-fare';
import {
  saveTripRequest,
  cancelTripRequestsForPassengerFavoriteSlot,
  findEnRouteRideIdForFavorite,
} from '../rides/api';
import { appBrand } from '../ui/theme/brand';

type IonName = ComponentProps<typeof Ionicons>['name'];
type SavedRoutesNav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'SavedRoutes'>,
  NativeStackNavigationProp<MainStackParamList>
>;

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

const PAGE_BG = appBrand.colors.background;
const QUICK_ICON_BG = appBrand.colors.greenLight;
const FIXED_SLOTS: PassengerFavoriteSlot[] = ['home_to_work', 'work_to_home'];

const ADD_ROUTE_HELP =
  'Marcá origen, destino y la hora de llegada deseada en el mapa. Cuando se asigne un móvil te avisamos y vas a poder ver la hora de recogida.';

function emojiForModalIon(name: IonName): string | null {
  switch (name) {
    case 'home-outline':
      return '🏠';
    case 'car-outline':
      return '🚗';
    case 'bus-outline':
      return '🚌';
    case 'walk-outline':
      return '🚶';
    case 'cafe-outline':
      return '☕';
    case 'navigate-outline':
      return '🧭';
    case 'location-outline':
      return '📍';
    case 'train-outline':
      return '🚆';
    case 'briefcase-outline':
      return '💼';
    case 'school-outline':
      return '🎓';
    case 'library-outline':
      return '📚';
    case 'business-outline':
      return '🏢';
    case 'barbell-outline':
      return '💪';
    case 'airplane-outline':
      return '✈️';
    case 'medical-outline':
      return '🏥';
    case 'cart-outline':
      return '🛒';
    case 'restaurant-outline':
      return '🍽️';
    default:
      return null;
  }
}

function filledIonFromOutline(name: IonName): IonName {
  const s = String(name);
  if (s.endsWith('-outline')) {
    return s.slice(0, s.length - '-outline'.length) as IonName;
  }
  return name;
}

function ModalRouteGlyph({ name }: { name: IonName }) {
  const em = emojiForModalIon(name);
  if (em) {
    return <Text style={styles.modalRouteEmoji}>{em}</Text>;
  }
  return <Ionicons name={filledIonFromOutline(name)} size={28} color={appBrand.colors.primary} />;
}

function emojiPairForPresetIcons(from: string, to: string): { a: string; b: string } | null {
  const a = emojiForModalIon(from as IonName);
  const b = emojiForModalIon(to as IonName);
  if (a && b) return { a, b };
  return null;
}

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
  const emPair = emojiPairForPresetIcons(from, to);
  if (emPair) {
    return (
      <View style={styles.emojiPill}>
        <View style={styles.emojiPillInner}>
          <Text style={styles.emojiPillChar}>{emPair.a}</Text>
          <Text style={styles.emojiPillChar}>→</Text>
          <Text style={styles.emojiPillChar}>{emPair.b}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.pairIconRow}>
      <Ionicons name={from} size={iconSize} color={appBrand.colors.primary} />
      <Ionicons name="arrow-forward" size={arrowSize} color="#6b7280" style={styles.pairArrow} />
      <Ionicons name={to} size={iconSize} color={appBrand.colors.primary} />
    </View>
  );
}

function formatFavoriteActiveSummary(snap: PassengerFavoriteSnapshot | undefined): string | null {
  if (!snap || !isFavoriteEnabled(snap)) return null;
  const ymd = String(snap.scheduledDateYmd ?? snap.date ?? '').trim();
  const iso = snap.nextTriggerAtIso?.trim();
  if (isScheduleDailySnap(snap)) {
    if (iso) {
      const d = new Date(iso);
      if (!Number.isNaN(d.getTime())) {
        return `Activo para ${d.toLocaleDateString('es-PY', { weekday: 'long', day: 'numeric', month: 'short' })}`;
      }
      return 'Activo (recordatorio diario)';
    }
  }
  if (ymd) {
    const d = new Date(ymd + 'T12:00:00');
    if (!Number.isNaN(d.getTime())) {
      return `Activo para ${d.toLocaleDateString('es-PY', { weekday: 'long', day: 'numeric', month: 'short' })}`;
    }
  }
  return 'Activo';
}

function PulseDot() {
  const op = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(op, { toValue: 0.35, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(op, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [op]);
  return <Animated.View style={[styles.pulseDot, { opacity: op }]} />;
}

function listSavedRouteSlotsToShow(
  favorites: Partial<Record<string, PassengerFavoriteSnapshot | undefined>>
): PassengerFavoriteSlot[] {
  const slots: PassengerFavoriteSlot[] = [...FIXED_SLOTS];
  const seen = new Set<string>(FIXED_SLOTS);
  for (const id of FAVORITE_PRESET_IDS) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (favoriteHasConfig(favorites[id])) slots.push(id);
  }
  return slots;
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
  const baseDate = String(snap.scheduledDateYmd ?? snap.date ?? '').trim();
  const pickupHm = String(snap.scheduledTimeHm ?? snap.fromTime ?? '').trim() || '08:00';
  const arrivalHm =
    snap.scheduledArrivalTimeHm != null ? String(snap.scheduledArrivalTimeHm).trim() : '';
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

const PASSENGER_RECURRING_MAX_EXTRA = 14;

function buildPassengerRecurringExtraYmds(
  anchorYmd: string,
  pickupHm: string,
  weekdayMask: number | undefined,
  maxExtra: number
): string[] {
  const mask = coerceScheduleWeekdayMask(weekdayMask);
  const hm = pickupHm.trim();
  const out: string[] = [];
  let ymd = addDaysToYmd(anchorYmd, 1);
  for (let i = 0; i < 60 && out.length < maxExtra; i++) {
    const parts = ymd.split('-').map((x) => parseInt(x, 10));
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) break;
    const dow = new Date(parts[0]!, parts[1]! - 1, parts[2]!, 12, 0, 0, 0).getDay();
    if ((mask & (1 << dow)) !== 0 && isPickupAtLeastLeadAhead(ymd, hm)) {
      out.push(ymd);
    }
    ymd = addDaysToYmd(ymd, 1);
  }
  return out;
}

const FALLBACK_PRICING: EffectivePricing = {
  minFarePyg: 7140,
  pygPerKm: 2780,
  roundTo: 100,
  blockSize: 4,
  blockMultiplier: 1.5,
  driverFeePercentOfCollected: 10,
  driverDebtLimitDefault: 50000,
  pricingSettingsId: null,
};

export function SavedRoutesScreen() {
  const navigation = useNavigation<SavedRoutesNav>();
  const route = useRoute<RouteProp<MainTabParamList, 'SavedRoutes'>>();
  const { session } = useAuth();
  const userId = session?.id ?? '';

  const [favorites, setFavorites] = useState<Partial<Record<PassengerFavoriteSlot, PassengerFavoriteSnapshot>>>({});
  const [addFavoriteOpen, setAddFavoriteOpen] = useState(false);
  const [fromIconIndex, setFromIconIndex] = useState(0);
  const [toIconIndex, setToIconIndex] = useState(0);
  const [activateOpen, setActivateOpen] = useState(false);
  const [activateSlot, setActivateSlot] = useState<PassengerFavoriteSlot | null>(null);
  const [activateSnap, setActivateSnap] = useState<PassengerFavoriteSnapshot | null>(null);
  const [activateModalDate, setActivateModalDate] = useState('');
  const [activateModalHm, setActivateModalHm] = useState('');
  const [activateModalShowDate, setActivateModalShowDate] = useState(false);
  const [activateModalShowTime, setActivateModalShowTime] = useState(false);
  const [activateRouteMinutes, setActivateRouteMinutes] = useState<number | null>(null);
  const [activateRouteLoading, setActivateRouteLoading] = useState(false);
  const activateRouteRequestIdRef = useRef(0);
  const activateModalSessionRef = useRef(false);
  const confirmActivateBusyRef = useRef(false);
  const passengerQuickActivateBusyRef = useRef(false);
  const [activateSubmitting, setActivateSubmitting] = useState(false);
  const [favoriteCostBySlot, setFavoriteCostBySlot] = useState<
    Partial<Record<PassengerFavoriteSlot, { perSeatGs: number; distanceKm: number } | null>>
  >({});

  const savedRouteSlots = useMemo(() => listSavedRouteSlotsToShow(favorites), [favorites]);
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
      if (next === 'active' && userId) refreshFavorites();
    });
    return () => sub.remove();
  }, [userId, refreshFavorites]);

  useFocusEffect(
    useCallback(() => {
      refreshFavorites();
    }, [refreshFavorites])
  );

  useEffect(() => {
    if (!session) {
      setFavoriteCostBySlot({});
      return;
    }
    let cancelled = false;

    void (async () => {
      const pricingSettings = await loadActivePricingSettings();
      const pricing = pricingSettings ? computeEffectivePricing(pricingSettings) : FALLBACK_PRICING;
      const nextCosts: Partial<
        Record<PassengerFavoriteSlot, { perSeatGs: number; distanceKm: number } | null>
      > = {};

      for (const slot of savedRouteSlots) {
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
        const routeRes = await fetchRoute(
          { lat: snap.originLat, lng: snap.originLng },
          { lat: snap.destinationLat, lng: snap.destinationLng },
          []
        );
        if (cancelled) return;

        const routeKm = Number(routeRes.distanceKm ?? 0);
        const fromRoute = Number.isFinite(routeKm) && routeKm > 0 && !routeRes.error && !routeRes.aborted;
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
  }, [session, savedRouteSlots, favorites]);

  const goFavorite = useCallback(
    async (slot: PassengerFavoriteSlot) => {
      if (!session) {
        Alert.alert('Inicia sesion', 'Necesitas una cuenta para guardar favoritos.');
        return;
      }
      setAddFavoriteOpen(false);
      const snap = favorites[slot];
      const enRouteRideId = await findEnRouteRideIdForFavorite(session.id, snap);
      if (enRouteRideId) {
        navigation.navigate('RideDetail', { rideId: enRouteRideId });
        return;
      }
      navigation.navigate('SearchPublishedRides', { favoriteSlot: slot });
    },
    [navigation, session, favorites]
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

  useFocusEffect(
    useCallback(() => {
      if (!route.params?.openAdd) return;
      openAddFavorite();
      navigation.setParams({ openAdd: false });
    }, [route.params?.openAdd, openAddFavorite, navigation])
  );

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
          const routeRes = await fetchRoute(
            { lat: snap.originLat!, lng: snap.originLng! },
            { lat: snap.destinationLat!, lng: snap.destinationLng! },
            []
          );
          if (requestId !== activateRouteRequestIdRef.current) return;
          setActivateRouteLoading(false);
          if (
            routeRes.durationMinutes == null ||
            routeRes.error ||
            routeRes.aborted ||
            !Number.isFinite(routeRes.durationMinutes)
          ) {
            if (storedArrivalHm) setActivateModalHm(pickupHm);
            return;
          }
          const routeMinutes = Math.max(1, Math.round(routeRes.durationMinutes));
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

  const quickActivatePassengerFavoriteOrOpenModal = useCallback(
    async (slot: PassengerFavoriteSlot) => {
      if (!session || !userId) return;
      if (passengerQuickActivateBusyRef.current) return;
      const snap = await getPassengerFavorite(userId, slot);
      if (!snap || !favoriteHasConfig(snap)) {
        Alert.alert('Primero configuralo', `Completa ${favoritePairLabel(slot)} y luego activa el switch.`);
        goFavorite(slot);
        return;
      }

      const hasCoords =
        snap.originLat != null &&
        snap.originLng != null &&
        snap.destinationLat != null &&
        snap.destinationLng != null;
      const arrivalConfigured = Boolean(snap.scheduledArrivalTimeHm?.trim());

      if (snap.rideKind === 'long_distance' || arrivalConfigured || !hasCoords) {
        void openActivateFavoriteModal(slot);
        return;
      }

      passengerQuickActivateBusyRef.current = true;
      try {
        const pickupHm = (snap.scheduledTimeHm ?? snap.fromTime ?? '08:00').trim() || '08:00';
        let d = (snap.scheduledDateYmd ?? snap.date ?? toYmdLocal(new Date())).trim();
        for (let i = 0; i < 400; i++) {
          if (isPickupAtLeastLeadAhead(d, pickupHm, MIN_BOOKING_LEAD_MS)) break;
          d = addDaysToYmd(d, 1);
        }
        if (!isPickupAtLeastLeadAhead(d, pickupHm, MIN_BOOKING_LEAD_MS)) {
          Alert.alert(
            'Anticipación mínima',
            'No se encontró una fecha con al menos 4 horas de anticipación. Elegí fecha y hora en el resumen.'
          );
          void openActivateFavoriteModal(slot);
          return;
        }

        const token = session.access_token?.trim();
        if (!token) {
          Alert.alert('Solicitud de viaje', 'No se pudo registrar la solicitud: sesión inválida.');
          return;
        }

        const routeRes = await fetchRoute(
          { lat: snap.originLat!, lng: snap.originLng! },
          { lat: snap.destinationLat!, lng: snap.destinationLng! },
          []
        );
        const poly = routeRes.polyline && routeRes.polyline.length >= 2 ? routeRes.polyline : null;

        const favoriteBase = {
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
          scheduleDaily: Boolean(snap.scheduleDaily),
          scheduleWeekdayMask: snap.scheduleWeekdayMask,
          scheduledDateYmd: d,
          scheduledTimeHm: pickupHm,
          scheduledArrivalTimeHm: undefined as string | undefined,
          nextTriggerAtIso:
            computeNextTriggerIso(new Date(), d, pickupHm, Boolean(snap.scheduleDaily), snap.scheduleWeekdayMask) ??
            undefined,
        };

        const recurringExtra = isScheduleDailySnap(snap)
          ? buildPassengerRecurringExtraYmds(d, pickupHm, snap.scheduleWeekdayMask, PASSENGER_RECURRING_MAX_EXTRA)
          : [];
        const baseTripArgs = {
          accessToken: token,
          userId,
          originLat: snap.originLat!,
          originLng: snap.originLng!,
          originLabel: (String(snap.origin ?? '').trim() || 'Origen').slice(0, 500),
          destinationLat: snap.destinationLat!,
          destinationLng: snap.destinationLng!,
          destinationLabel: (String(snap.destination ?? '').trim() || 'Destino').slice(0, 500),
          requestedDate: d,
          requestedTime: normalizeHmForTripRequest(pickupHm),
          seats: 1,
          routePolyline: poly,
          routeLengthKm: routeRes.distanceKm ?? null,
          pricingKind: 'internal' as const,
          internalQuoteAcknowledged: true,
          passengerFavoriteSlot: slot,
          ...(recurringExtra.length > 0 ? { extraRequestedDates: recurringExtra } : {}),
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
          await upsertPassengerFavorite(userId, slot, { ...favoriteBase, enabled: false });
          const allFail = await loadPassengerFavorites(userId);
          setFavorites(allFail);
          void pushPassengerHomeMapShortcuts(allFail);
          return;
        }

        await upsertPassengerFavorite(userId, slot, { ...favoriteBase, enabled: true });
        const all = await loadPassengerFavorites(userId);
        setFavorites(all);
        void pushPassengerHomeMapShortcuts(all);
      } finally {
        passengerQuickActivateBusyRef.current = false;
      }
    },
    [session, userId, goFavorite, openActivateFavoriteModal]
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
      const favoriteBase = {
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
        scheduleDaily: Boolean(snap.scheduleDaily),
        scheduleWeekdayMask: snap.scheduleWeekdayMask,
        scheduledDateYmd: d,
        scheduledTimeHm: pickupHm,
        scheduledArrivalTimeHm: dur != null ? hm.trim() : undefined,
        nextTriggerAtIso:
          computeNextTriggerIso(new Date(), d, pickupHm, Boolean(snap.scheduleDaily), snap.scheduleWeekdayMask) ??
          undefined,
      };
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
          return;
        }
        const routeRes = await fetchRoute(
          { lat: snap.originLat!, lng: snap.originLng! },
          { lat: snap.destinationLat!, lng: snap.destinationLng! },
          []
        );
        const poly = routeRes.polyline && routeRes.polyline.length >= 2 ? routeRes.polyline : null;
        const recurringExtra = isScheduleDailySnap(snap)
          ? buildPassengerRecurringExtraYmds(d, pickupHm, snap.scheduleWeekdayMask, PASSENGER_RECURRING_MAX_EXTRA)
          : [];
        const baseTripArgs = {
          accessToken: token,
          userId,
          originLat: snap.originLat!,
          originLng: snap.originLng!,
          originLabel: (String(snap.origin ?? '').trim() || 'Origen').slice(0, 500),
          destinationLat: snap.destinationLat!,
          destinationLng: snap.destinationLng!,
          destinationLabel: (String(snap.destination ?? '').trim() || 'Destino').slice(0, 500),
          requestedDate: d,
          requestedTime: normalizeHmForTripRequest(pickupHm),
          seats: 1,
          routePolyline: poly,
          routeLengthKm: routeRes.distanceKm ?? null,
          pricingKind: 'internal' as const,
          internalQuoteAcknowledged: true,
          passengerFavoriteSlot: activateSlot,
          ...(recurringExtra.length > 0 ? { extraRequestedDates: recurringExtra } : {}),
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
          await upsertPassengerFavorite(userId, activateSlot, { ...favoriteBase, enabled: false });
          const allFail = await loadPassengerFavorites(userId);
          setFavorites(allFail);
          void pushPassengerHomeMapShortcuts(allFail);
          return;
        }
      }

      await upsertPassengerFavorite(userId, activateSlot, { ...favoriteBase, enabled: true });
      const all = await loadPassengerFavorites(userId);
      setFavorites(all);
      void pushPassengerHomeMapShortcuts(all);
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
      Alert.alert('Eliminar favorito', `Se eliminara ${favoritePairLabel(slot)} de Rutas guardadas.`, [
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
    <>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <Text style={styles.sectionTitle}>RUTAS GUARDADAS</Text>
          <View style={styles.addRow}>
            <TouchableOpacity
              onPress={openAddFavorite}
              accessibilityRole="button"
              accessibilityLabel="Agregar ruta"
              style={styles.addBtn}
            >
              <Ionicons name="add" size={16} color={appBrand.colors.primary} />
              <Text style={styles.addLabel}>Agregar</Text>
            </TouchableOpacity>
            <TinyHelpButton title="Agregar ruta" message={ADD_ROUTE_HELP} />
          </View>
        </View>

        {savedRouteSlots.map((slot) => {
          const snap = favorites[slot];
          const enabled = isFavoriteEnabled(snap);
          const switchShowsOn = enabled || (activateOpen && activateSlot === slot);
          const configured = favoriteHasConfig(snap);
          const activeSummary = formatFavoriteActiveSummary(snap);
          const isActiveCard = configured && enabled;
          return (
            <TouchableOpacity
              key={slot}
              style={[styles.routeCard, isActiveCard && styles.routeCardActive]}
              onPress={() => goFavorite(slot)}
              accessibilityRole="button"
              accessibilityLabel={`Favorito ${favoritePairLabel(slot)}`}
            >
              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={() => deleteFavorite(slot)}
                accessibilityRole="button"
                accessibilityLabel={`Eliminar ${favoritePairLabel(slot)}`}
              >
                <Ionicons name="close" size={12} color="#b91c1c" />
              </TouchableOpacity>
              <View style={styles.routeBody}>
                <View style={styles.routeTopRow}>
                  <FavoritePairIcons slot={slot} iconSize={18} arrowSize={14} />
                  {!configured ? (
                    <View style={styles.warnPill}>
                      <Text style={styles.warnPillText}>⚙ Sin configurar</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.routeName}>{favoritePairLabel(slot)}</Text>
                <Text style={styles.routeMeta}>{scheduleLabel(snap)}</Text>
                {snap?.rideKind === 'long_distance' ? (
                  <Text style={styles.routeCostMuted}>Costo: se negocia con conductor</Text>
                ) : favoriteCostBySlot[slot] != null ? (
                  <Text style={styles.routeCost}>
                    ₲ {Number(favoriteCostBySlot[slot]?.perSeatGs ?? 0).toLocaleString('es-PY')} estim.
                  </Text>
                ) : (
                  <Text style={styles.routeCostMuted}>Costo estimado: no disponible</Text>
                )}
                {activeSummary ? (
                  <View style={styles.activeStrip}>
                    <PulseDot />
                    <Text style={styles.activeStripText}>{activeSummary}</Text>
                  </View>
                ) : null}
              </View>
              <View
                style={styles.switchCol}
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
                    void quickActivatePassengerFavoriteOrOpenModal(slot);
                  }}
                  trackColor={{ false: '#e5e7eb', true: '#b6e2c9' }}
                  thumbColor={switchShowsOn ? appBrand.colors.primary : '#f9fafb'}
                />
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <Modal
        visible={addFavoriteOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setAddFavoriteOpen(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setAddFavoriteOpen(false)} />
          <SafeAreaView style={styles.modalSheet} edges={['bottom']}>
            <View style={styles.modalGrabber} accessible={false} importantForAccessibility="no" />
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
                    <Ionicons name="chevron-up" size={22} color={appBrand.colors.primary} />
                  </TouchableOpacity>
                  <View style={styles.modalIconBox}>
                    <ModalRouteGlyph name={selectedFromIcon as IonName} />
                  </View>
                  <TouchableOpacity
                    style={styles.modalArrowBtn}
                    onPress={() => setFromIconIndex((v) => rotateOriginIndex(v, 1))}
                    accessibilityRole="button"
                    accessibilityLabel="Icono origen siguiente"
                  >
                    <Ionicons name="chevron-down" size={22} color={appBrand.colors.primary} />
                  </TouchableOpacity>
                </View>
                <View style={styles.modalMiddleArrowBadge}>
                  <Ionicons name="arrow-forward" size={28} color={appBrand.colors.primary} style={styles.modalMiddleArrow} />
                </View>

                <View style={styles.modalSelectorColumn}>
                  <TouchableOpacity
                    style={styles.modalArrowBtn}
                    onPress={() => setToIconIndex((v) => rotateDestIndex(v, -1))}
                    accessibilityRole="button"
                    accessibilityLabel="Icono destino anterior"
                  >
                    <Ionicons name="chevron-up" size={22} color={appBrand.colors.primary} />
                  </TouchableOpacity>
                  <View style={styles.modalIconBox}>
                    <ModalRouteGlyph name={selectedToIcon as IonName} />
                  </View>
                  <TouchableOpacity
                    style={styles.modalArrowBtn}
                    onPress={() => setToIconIndex((v) => rotateDestIndex(v, 1))}
                    accessibilityRole="button"
                    accessibilityLabel="Icono destino siguiente"
                  >
                    <Ionicons name="chevron-down" size={22} color={appBrand.colors.primary} />
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

      <Modal visible={activateOpen} transparent animationType="fade" onRequestClose={cancelActivateFavorite}>
        <Pressable style={styles.activateModalOverlay} onPress={cancelActivateFavorite}>
          <Pressable style={styles.activateModalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.activateModalTitle}>Activar favorito</Text>
            <Text style={styles.activateModalSubtitle}>
              Confirmá la fecha y la <Text style={styles.activateModalEm}>hora estimada de llegada</Text> al destino para{' '}
              {activateSlot ? (
                <Text style={styles.activateModalEm}>{favoritePairLabel(activateSlot)}</Text>
              ) : (
                'este trayecto'
              )}
              .
              {activateRouteMinutes == null && !activateRouteLoading ? (
                <>
                  {'\n\n'}
                  Sin duración por mapa: la hora que elijas se guarda como salida o recogida (marcá origen y destino en
                  el mapa al editar el favorito para estimar llegada).
                </>
              ) : null}
            </Text>
            {activateRouteLoading ? (
              <View style={styles.activateModalLoadingRow}>
                <ActivityIndicator size="small" color={appBrand.colors.primary} />
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
                display={datePickerDisplay()}
                minimumDate={startOfLocalDay()}
                onChange={(ev, picked) => {
                  if (ev.type === 'dismissed') {
                    setActivateModalShowDate(false);
                    return;
                  }
                  if (Platform.OS !== 'ios') setActivateModalShowDate(false);
                  if (picked) {
                    setActivateModalDate(toYmdLocal(clampDateNotBeforeLocalDay(picked, new Date())));
                  }
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
                display={timePickerDisplay()}
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
                Mientras tanto la hora mostrada es la de salida o recogida guardada; al terminar el cálculo se ajusta a
                la llegada estimada.
              </Text>
            ) : activateRouteMinutes != null ? (
              <Text style={styles.activateModalHint}>
                La salida o recogida se calcula con la ruta del mapa (~{activateRouteMinutes} min). Tiene que quedar al
                menos 4 horas desde ahora. Podés cambiar fecha y hora de llegada antes de confirmar.
              </Text>
            ) : (
              <Text style={styles.activateModalHint}>
                Si la fecha guardada ya pasó o queda a menos de 4 horas, te sugerimos el próximo día posible. Podés
                cambiar fecha y hora acá antes de confirmar.
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
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: PAGE_BG },
  scrollContent: { flexGrow: 1, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 28 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.9,
    color: '#64748b',
    fontFamily: appBrand.fonts.semibold,
  },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  addLabel: { fontSize: 13, fontWeight: '800', color: appBrand.colors.primary, fontFamily: appBrand.fonts.semibold },
  routeCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fff',
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  routeCardActive: {
    borderWidth: 2,
    borderColor: '#c6e6d3',
    shadowColor: appBrand.colors.primary,
    shadowOpacity: 0.14,
    shadowRadius: 14,
    elevation: 3,
  },
  routeBody: { flex: 1, minWidth: 0, paddingRight: 6 },
  routeTopRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  emojiPill: {
    backgroundColor: '#e5e7eb',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  emojiPillInner: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  emojiPillChar: { fontSize: 14 },
  warnPill: { backgroundColor: '#fef3c7', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  warnPillText: { fontSize: 11, fontWeight: '700', color: '#92400e', fontFamily: appBrand.fonts.semibold },
  routeName: { fontSize: 15, fontWeight: '800', color: '#111827', fontFamily: appBrand.fonts.semibold },
  routeMeta: { fontSize: 12, color: '#6b7280', marginTop: 2, fontFamily: appBrand.fonts.regular },
  routeCost: { fontSize: 13, fontWeight: '700', color: appBrand.colors.primary, marginTop: 4, fontFamily: appBrand.fonts.semibold },
  routeCostMuted: { fontSize: 12, color: '#9ca3af', marginTop: 4, fontFamily: appBrand.fonts.regular },
  switchCol: { justifyContent: 'flex-start', paddingTop: 2 },
  activeStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: appBrand.colors.greenLight,
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    gap: 8,
  },
  activeStripText: { fontSize: 12, fontWeight: '700', color: appBrand.colors.primary, flex: 1, fontFamily: appBrand.fonts.semibold },
  pulseDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: appBrand.colors.primary },
  deleteBtn: {
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
  pairIconRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  pairArrow: { marginHorizontal: 3 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 23, 42, 0.48)' },
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '62%',
    paddingBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 16,
  },
  modalGrabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#e2e8f0',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eef0f3',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    flex: 1,
    paddingRight: 8,
    fontFamily: appBrand.fonts.semibold,
    letterSpacing: -0.2,
  },
  modalClose: { fontSize: 15, fontWeight: '700', color: appBrand.colors.primary, fontFamily: appBrand.fonts.semibold },
  modalHint: {
    fontSize: 13,
    color: '#64748b',
    paddingHorizontal: 20,
    paddingVertical: 12,
    lineHeight: 19,
    fontFamily: appBrand.fonts.regular,
  },
  modalPickerWrap: {
    paddingHorizontal: 18,
    paddingBottom: 18,
    paddingTop: 4,
  },
  modalPickerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  modalSelectorColumn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 84,
  },
  modalIconBox: {
    width: 60,
    height: 60,
    borderRadius: 16,
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalRouteEmoji: {
    fontSize: 28,
    lineHeight: 32,
    textAlign: 'center',
  },
  modalArrowBtn: {
    width: 44,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalMiddleArrowBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: QUICK_ICON_BG,
    borderWidth: 1,
    borderColor: '#b6e2c9',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 34,
  },
  modalMiddleArrow: { marginLeft: 1 },
  modalCounterText: {
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 8,
    marginBottom: 16,
    fontFamily: appBrand.fonts.medium,
  },
  modalSaveBtn: {
    backgroundColor: appBrand.colors.primary,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    shadowColor: appBrand.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 4,
  },
  modalSaveBtnText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 15,
    fontFamily: appBrand.fonts.semibold,
    letterSpacing: 0.2,
  },
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
  activateModalEm: { fontWeight: '700', color: appBrand.colors.primary },
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
  activateModalBtnPrimary: { backgroundColor: appBrand.colors.primary },
  activateModalBtnPrimaryDisabled: { opacity: 0.55 },
  activateModalBtnPrimaryText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
