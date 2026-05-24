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
  Animated,
  Easing,
  type AppStateStatus,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import type { SessionProfile } from '../auth/session';
import type { MainTabParamList } from '../navigation/types';
import { fetchMyConversations } from '../api/messages';
import { getAppFlavor } from '../core/flavor';
import {
  fetchPassengerHomeFavoritesCopy,
  fetchPassengerHomeShortcutsVisible,
  DEFAULT_PASSENGER_HOME_FAVORITES_TITLE,
  DEFAULT_PASSENGER_HOME_FAVORITES_SUBTITLE,
} from '../backend/passengerUiSettings';
import { fetchDriverHomeHowTo, DEFAULT_DRIVER_HOME_HOW_TO } from '../backend/driverUiSettings';
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
  findPassengerActiveRideShortcut,
  fetchMyRides,
  fetchMyBookings,
} from '../rides/api';
import { supabase } from '../backend/supabase';
import { DEFAULT_RATING_STARS, formatProfileRatingStars } from '../lib/profileRating';
import { updateRideStatus } from '../backend/rideStatus';
import {
  loadDriverHomeTemplateRows,
  upsertDriverHomeTemplateRow,
  removeDriverHomeTemplateRow,
  driverTemplateHasConfig,
  driverScheduleLabel,
  getDriverHomeTemplateRow,
  type DriverHomeTemplateRow,
} from '../lib/driverHomeTemplates';
import { appBrand } from '../ui/theme/brand';

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

const PASSENGER_PAGE_BG = appBrand.colors.background;
const PASSENGER_QUICK_ICON_BG = appBrand.colors.greenLight;

/** Misma lectura visual que las pills del inicio (emojis donde aplica). */
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

type HomeTabNav = BottomTabNavigationProp<MainTabParamList, 'Home'>;
type ParentNav = { navigate: (name: string, params?: object) => void };
const HOME_FIXED_SLOTS: PassengerFavoriteSlot[] = ['home_to_work', 'work_to_home'];

function passengerGreetingLine(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Buenos días';
  if (h >= 12 && h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

function userInitialFromSession(s: SessionProfile | null): string {
  const name = String(s?.full_name ?? '').trim();
  if (name) return name.charAt(0).toUpperCase();
  const em = String(s?.email ?? '').trim();
  if (em) return em.charAt(0).toUpperCase();
  return '?';
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

function rideFromBookingRow(row: Record<string, unknown>): Record<string, unknown> | null {
  const r = row.ride;
  if (Array.isArray(r)) return (r[0] as Record<string, unknown>) ?? null;
  return r && typeof r === 'object' ? (r as Record<string, unknown>) : null;
}

function isHistoryBookingRow(row: Record<string, unknown>, ride: Record<string, unknown> | null): boolean {
  const bst = String(row.status ?? '');
  const rst = ride?.status != null ? String(ride.status) : '';
  if (bst === 'completed' || bst === 'cancelled') return true;
  if (rst === 'completed' || rst === 'cancelled') return true;
  return false;
}

function countActiveBookings(rows: unknown[]): number {
  let n = 0;
  for (const raw of rows) {
    const row = raw as Record<string, unknown>;
    const ride = rideFromBookingRow(row);
    if (!isHistoryBookingRow(row, ride)) n++;
  }
  return n;
}

function HomePulseDot() {
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

function driverCardReady(row: DriverHomeTemplateRow | undefined): boolean {
  return driverTemplateHasConfig(row) && Boolean(row?.tripDisplayName?.trim());
}

function favoriteHasConfig(snap: PassengerFavoriteSnapshot | undefined): boolean {
  if (!snap) return false;
  const o = typeof snap.origin === 'string' ? snap.origin.trim() : '';
  const d = typeof snap.destination === 'string' ? snap.destination.trim() : '';
  if (o && d) return true;
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

/** Solicitudes `pending` adicionales (misma hora) para agrupar demanda con anticipación. */
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
  const [activeHomeRideId, setActiveHomeRideId] = useState<string | null>(null);

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
  const passengerQuickActivateBusyRef = useRef(false);
  const [activateSubmitting, setActivateSubmitting] = useState(false);
  const [favoriteCostBySlot, setFavoriteCostBySlot] = useState<
    Partial<Record<PassengerFavoriteSlot, { perSeatGs: number; distanceKm: number } | null>>
  >({});
  const [driverTemplateRows, setDriverTemplateRows] = useState<DriverHomeTemplateRow[]>([]);
  const [homeMessagesBadge, setHomeMessagesBadge] = useState(0);
  const [homeBookingsBadge, setHomeBookingsBadge] = useState(0);
  const [driverTripsCompletedCount, setDriverTripsCompletedCount] = useState(0);
  const [driverRatingAvg, setDriverRatingAvg] = useState(DEFAULT_RATING_STARS);
  const [driverPassengersServedCount, setDriverPassengersServedCount] = useState(0);
  const [driverPendingTripRequestsBadge, setDriverPendingTripRequestsBadge] = useState(0);
  const [driverHomeMessagesBadge, setDriverHomeMessagesBadge] = useState(0);
  const [driverHomeHowTo, setDriverHomeHowTo] = useState(DEFAULT_DRIVER_HOME_HOW_TO);

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

  const refreshDriverTemplates = useCallback(() => {
    if (!userId || isPassengerFlavor) return;
    void loadDriverHomeTemplateRows(userId).then(setDriverTemplateRows);
  }, [userId, isPassengerFlavor]);

  const refreshDriverHomeSummary = useCallback(async () => {
    if (!session?.id || isPassengerFlavor) return;
    const uid = session.id;
    const today = new Date().toISOString().slice(0, 10);
    try {
      const [convos, completedRidesRes, profileRes, pendingReqRes] = await Promise.all([
        fetchMyConversations(uid),
        supabase.from('rides').select('id').eq('driver_id', uid).eq('status', 'completed'),
        supabase.from('profiles').select('rating_average, rating_count').eq('id', uid).maybeSingle(),
        supabase
          .from('trip_requests')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending')
          .gte('requested_date', today),
      ]);
      if (completedRidesRes.error) {
        setDriverTripsCompletedCount(0);
        setDriverPassengersServedCount(0);
      } else {
        const ids = (completedRidesRes.data ?? [])
          .map((r) => String((r as { id?: unknown }).id ?? '').trim())
          .filter(Boolean);
        setDriverTripsCompletedCount(ids.length);
        if (ids.length === 0) {
          setDriverPassengersServedCount(0);
        } else {
          const { count: bookCount, error: bookErr } = await supabase
            .from('bookings')
            .select('id', { count: 'exact', head: true })
            .in('ride_id', ids);
          setDriverPassengersServedCount(!bookErr && typeof bookCount === 'number' ? bookCount : 0);
        }
      }
      const unread = convos.reduce((acc, c) => acc + Math.max(0, Number(c.unread_count) || 0), 0);
      setDriverHomeMessagesBadge(unread);
      const prof = profileRes.data as { rating_average?: number | null; rating_count?: number | null } | null;
      const stars = formatProfileRatingStars(prof?.rating_average, prof?.rating_count);
      setDriverRatingAvg(Number(stars));
      setDriverPendingTripRequestsBadge(typeof pendingReqRes.count === 'number' ? pendingReqRes.count : 0);
    } catch {
      setDriverHomeMessagesBadge(0);
      setDriverTripsCompletedCount(0);
      setDriverRatingAvg(DEFAULT_RATING_STARS);
      setDriverPassengersServedCount(0);
      setDriverPendingTripRequestsBadge(0);
    }
  }, [session?.id, isPassengerFlavor]);

  const goDriverNewRoutePublish = useCallback(() => {
    parentNav?.navigate('PublishRide', {
      createDriverTemplate: true,
      publishKind: 'internal',
    });
  }, [parentNav]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active' && userId) {
        if (isPassengerFlavor) refreshFavorites();
        else refreshDriverTemplates();
      }
    });
    return () => sub.remove();
  }, [userId, isPassengerFlavor, refreshFavorites, refreshDriverTemplates]);

  useFocusEffect(
    useCallback(() => {
      refreshFavorites();
    }, [refreshFavorites])
  );

  useFocusEffect(
    useCallback(() => {
      if (isPassengerFlavor) return;
      refreshDriverTemplates();
      void refreshDriverHomeSummary();
      void (async () => {
        const copy = await fetchDriverHomeHowTo();
        setDriverHomeHowTo(copy);
      })();
    }, [isPassengerFlavor, refreshDriverTemplates, refreshDriverHomeSummary])
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const run = async () => {
        if (!session?.id) {
          if (!cancelled) setActiveHomeRideId(null);
          return;
        }
        if (!isPassengerFlavor) {
          try {
            const rides = await fetchMyRides(session.id);
            const enRoute = rides.find((r: { status?: unknown; id?: unknown }) => String(r.status ?? '') === 'en_route');
            if (!cancelled) setActiveHomeRideId(enRoute ? String(enRoute.id ?? '').trim() || null : null);
          } catch {
            if (!cancelled) setActiveHomeRideId(null);
          }
          return;
        }
        const favoriteSlots = Object.entries(favorites)
          .filter(([, snap]) => favoriteHasConfig(snap) && isFavoriteEnabled(snap))
          .map(([slot]) => String(slot));
        const rideId = await findPassengerActiveRideShortcut({
          userId: session.id,
          favoriteSlots,
        });
        if (!cancelled) setActiveHomeRideId(rideId);
      };
      void run();
      return () => {
        cancelled = true;
      };
    }, [session?.id, isPassengerFlavor, favorites])
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

  useFocusEffect(
    useCallback(() => {
      if (!session?.id || !isPassengerFlavor) return;
      let cancelled = false;
      void (async () => {
        try {
          const [convos, bookings] = await Promise.all([
            fetchMyConversations(session.id),
            fetchMyBookings(session.id),
          ]);
          if (cancelled) return;
          const unread = convos.reduce((acc, c) => acc + Math.max(0, Number(c.unread_count) || 0), 0);
          setHomeMessagesBadge(unread);
          setHomeBookingsBadge(countActiveBookings(bookings));
        } catch {
          if (!cancelled) {
            setHomeMessagesBadge(0);
            setHomeBookingsBadge(0);
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [session?.id, isPassengerFlavor])
  );

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
        parentNav?.navigate('RideDetail', { rideId: enRouteRideId });
        return;
      }
      parentNav?.navigate('SearchPublishedRides', { favoriteSlot: slot });
    },
    [parentNav, session, favorites]
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

  const deleteDriverTemplate = useCallback(
    (id: string, displayName: string) => {
      if (!session || !userId) return;
      const label = displayName.trim() || 'esta plantilla';
      Alert.alert('Eliminar plantilla', `Se borrará «${label}» solo en este dispositivo.`, [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await removeDriverHomeTemplateRow(userId, id);
              const rows = await loadDriverHomeTemplateRows(userId);
              setDriverTemplateRows(rows);
            })();
          },
        },
      ]);
    },
    [session, userId]
  );

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

  /**
   * Con trayecto guardado en modo recogida (sin hora de llegada) y coords: activar y registrar
   * `trip_request` sin abrir el modal, misma regla de 4 h que `openActivateFavoriteModal`.
   * Larga distancia, llegada al destino o sin coords → se mantiene el modal.
   */
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

        const route = await fetchRoute(
          { lat: snap.originLat!, lng: snap.originLng! },
          { lat: snap.destinationLat!, lng: snap.destinationLng! },
          []
        );
        const poly = route.polyline && route.polyline.length >= 2 ? route.polyline : null;

        await upsertPassengerFavorite(userId, slot, {
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
          scheduledArrivalTimeHm: undefined,
          nextTriggerAtIso:
            computeNextTriggerIso(new Date(), d, pickupHm, Boolean(snap.scheduleDaily), snap.scheduleWeekdayMask) ??
            undefined,
        });

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
          routeLengthKm: route.distanceKm ?? null,
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
        }

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
            routeLengthKm: route.distanceKm ?? null,
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
      style={[styles.scroll, session ? styles.scrollPassengerPage : null]}
      contentContainerStyle={[styles.scrollContent, session ? styles.scrollContentPassengerPage : null]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {isPassengerFlavor && session ? (
        <View style={styles.passengerShell}>
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

          <View style={styles.homeHeaderRow}>
            <View style={styles.homeHeaderTextCol}>
              <Text style={styles.homeGreetingLine}>
                {passengerGreetingLine()} <Text>👋</Text>
              </Text>
              <Text style={styles.homeGreetingQuestion}>¿A dónde vas hoy?</Text>
            </View>
            <TouchableOpacity
              style={styles.homeAvatar}
              onPress={() => navigation.navigate('Settings')}
              accessibilityRole="button"
              accessibilityLabel="Ajustes y perfil"
            >
              <Text style={styles.homeAvatarLetter}>{userInitialFromSession(session)}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.heroCard}>
            <View style={[styles.heroBlob, styles.heroBlob1]} />
            <View style={[styles.heroBlob, styles.heroBlob2]} />
            <Text style={styles.heroEyebrow}>VIAJÁ INTELIGENTE</Text>
            <Text style={styles.heroTitle} numberOfLines={4}>
              {favoritesTitle}
            </Text>
            <Text style={styles.heroSubtitle} numberOfLines={5}>
              {favoritesSubtitle}
            </Text>
            <TouchableOpacity
              style={styles.heroCtaBtn}
              onPress={openAddFavorite}
              accessibilityRole="button"
              accessibilityLabel="Programar viaje"
            >
              <Ionicons name="add" size={22} color={appBrand.colors.primary} />
              <Text style={styles.heroCtaText}>Programar viaje</Text>
            </TouchableOpacity>
          </View>

          {activeHomeRideId ? (
            <TouchableOpacity
              style={[styles.activeRideShortcutBtn, styles.activeRideShortcutBtnPassenger]}
              onPress={() => parentNav?.navigate('RideDetail', { rideId: activeHomeRideId })}
              accessibilityRole="button"
              accessibilityLabel="Abrir viaje actual"
            >
              <Ionicons name="navigate-circle-outline" size={20} color="#fff" />
              <Text style={styles.activeRideShortcutBtnText}>Ir a mi viaje actual</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={styles.searchCard}
            onPress={() => parentNav?.navigate('SearchPublishedRides', {})}
            accessibilityRole="button"
            accessibilityLabel="Buscar viajes"
          >
            <Ionicons name="search" size={20} color="#9ca3af" style={styles.searchCardIcon} />
            <Text style={styles.searchCardPlaceholder}>Buscá un código o ruta…</Text>
          </TouchableOpacity>

          <View style={styles.routesSectionHeaderRow}>
            <Text style={styles.routesSectionTitle}>RUTAS GUARDADAS</Text>
            <TouchableOpacity onPress={openAddFavorite} accessibilityRole="button" accessibilityLabel="Agregar ruta">
              <Text style={styles.routesSectionAdd}>+ Agregar</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.routesListWrap}>
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
                  const activeSummary = formatFavoriteActiveSummary(snap);
                  const isActiveCard = configured && enabled;
                  return (
                    <TouchableOpacity
                      key={slot}
                      style={[styles.passengerRouteCard, isActiveCard && styles.passengerRouteCardActive]}
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
                      <View style={styles.passengerRouteBody}>
                        <View style={styles.passengerRouteTopRow}>
                          <FavoritePairIcons slot={slot} iconSize={18} arrowSize={14} />
                          {!configured ? (
                            <View style={styles.warnPill}>
                              <Text style={styles.warnPillText}>⚙ Sin configurar</Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={styles.passengerRouteName}>{favoritePairLabel(slot)}</Text>
                        <Text style={styles.passengerRouteMeta}>{scheduleLabel(snap)}</Text>
                        {snap?.rideKind === 'long_distance' ? (
                          <Text style={styles.passengerRouteCostMuted}>Costo: se negocia con conductor</Text>
                        ) : favoriteCostBySlot[slot] != null ? (
                          <Text style={styles.passengerRouteCost}>
                            ₲ {Number(favoriteCostBySlot[slot]?.perSeatGs ?? 0).toLocaleString('es-PY')} estim.
                          </Text>
                        ) : (
                          <Text style={styles.passengerRouteCostMuted}>Costo estimado: no disponible</Text>
                        )}
                        {activeSummary ? (
                          <View style={styles.activeStrip}>
                            <HomePulseDot />
                            <Text style={styles.activeStripText}>{activeSummary}</Text>
                          </View>
                        ) : null}
                      </View>
                      <View
                        style={styles.passengerRouteSwitchCol}
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
                      <ActivityIndicator size="small" color="appBrand.colors.primary" />
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
                          setActivateModalDate(
                            toYmdLocal(clampDateNotBeforeLocalDay(picked, new Date()))
                          );
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
              <View style={styles.quickActionsWrap}>
                <Text style={styles.quickActionsTitle}>ACCIONES RÁPIDAS</Text>
                <View style={styles.quickGridRow}>
                  <TouchableOpacity
                    style={styles.quickTile}
                    onPress={() => parentNav?.navigate('SaveTripRequest', undefined)}
                    accessibilityRole="button"
                    accessibilityLabel="Crear viaje o solicitud de trayecto"
                  >
                    <View style={styles.quickIconSquare}>
                      <Ionicons name="add-circle-outline" size={26} color={appBrand.colors.primary} />
                    </View>
                    <Text style={styles.quickTileLabel}>Crear viaje</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.quickTile}
                    onPress={() => parentNav?.navigate('MyBookings')}
                    accessibilityRole="button"
                    accessibilityLabel="Mis reservas"
                  >
                    {homeBookingsBadge > 0 ? (
                      <View style={styles.quickBadge} accessibilityLabel={`${homeBookingsBadge} reservas activas`}>
                        <Text style={styles.quickBadgeText}>{homeBookingsBadge > 99 ? '99+' : homeBookingsBadge}</Text>
                      </View>
                    ) : null}
                    <View style={styles.quickIconSquare}>
                      <Ionicons name="calendar-outline" size={24} color={appBrand.colors.primary} />
                    </View>
                    <Text style={styles.quickTileLabel}>Mis reservas</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.quickGridRow}>
                  <TouchableOpacity
                    style={styles.quickTile}
                    onPress={() => parentNav?.navigate('Messages')}
                    accessibilityRole="button"
                    accessibilityLabel="Mensajes"
                  >
                    {homeMessagesBadge > 0 ? (
                      <View style={styles.quickBadge} accessibilityLabel={`${homeMessagesBadge} mensajes sin leer`}>
                        <Text style={styles.quickBadgeText}>{homeMessagesBadge > 99 ? '99+' : homeMessagesBadge}</Text>
                      </View>
                    ) : null}
                    <View style={styles.quickIconSquare}>
                      <Ionicons name="chatbubble-ellipses-outline" size={24} color={appBrand.colors.primary} />
                    </View>
                    <Text style={styles.quickTileLabel}>Mensajes</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.quickTile}
                    onPress={() => parentNav?.navigate('MyTripRequests')}
                    accessibilityRole="button"
                    accessibilityLabel="Solicitudes"
                  >
                    <View style={styles.quickIconSquare}>
                      <Ionicons name="document-text-outline" size={24} color={appBrand.colors.primary} />
                    </View>
                    <Text style={styles.quickTileLabel}>Solicitudes</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
        </View>
        ) : null}

        {!isPassengerFlavor && session ? (
          <View style={styles.driverShell}>
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

            <View style={styles.driverHeaderRow}>
              <View style={styles.driverHeaderTextCol}>
                <Text style={styles.driverGreetingMuted}>Bienvenido de vuelta</Text>
                <Text style={styles.driverPanelTitle}>Panel conductor</Text>
              </View>
              <TouchableOpacity
                onPress={() => navigation.navigate('Settings')}
                accessibilityRole="button"
                accessibilityLabel="Ir a ajustes"
                activeOpacity={0.85}
                style={styles.driverAvatarTouch}
              >
                <View style={styles.driverAvatarGradient}>
                  <Text style={styles.driverAvatarLetterWhite}>{userInitialFromSession(session)}</Text>
                </View>
                {driverHomeMessagesBadge + driverPendingTripRequestsBadge > 0 ? (
                  <View style={styles.driverAvatarNotifyDot} />
                ) : null}
              </TouchableOpacity>
            </View>

            <View style={styles.driverStatsRow}>
              <View style={styles.driverStatCard}>
                <Text style={styles.driverStatValue}>{driverTripsCompletedCount}</Text>
                <Text style={styles.driverStatLabel}>Viajes</Text>
              </View>
              <View style={styles.driverStatCard}>
                <Text style={styles.driverStatValue}>{driverRatingAvg.toFixed(1)}★</Text>
                <Text style={styles.driverStatLabel}>Calificación</Text>
              </View>
              <View style={styles.driverStatCard}>
                <Text style={styles.driverStatValue}>{driverPassengersServedCount}</Text>
                <Text style={styles.driverStatLabel}>Pasajeros</Text>
              </View>
            </View>

            <TouchableOpacity
              onPress={goDriverNewRoutePublish}
              activeOpacity={0.92}
              style={styles.driverPrimaryGradientOuter}
              accessibilityRole="button"
              accessibilityLabel="Publicar nueva ruta"
            >
              <View style={styles.driverPrimaryGradientInner}>
                <Ionicons name="add" size={22} color="#fff" />
                <Text style={styles.driverPrimaryGradientLabel}>Publicar nueva ruta</Text>
              </View>
            </TouchableOpacity>

            {activeHomeRideId ? (
              <TouchableOpacity
                style={styles.driverActiveRideBtn}
                onPress={() => parentNav?.navigate('RideDetail', { rideId: activeHomeRideId })}
                accessibilityRole="button"
                accessibilityLabel="Abrir viaje en curso"
              >
                <Ionicons name="navigate-circle-outline" size={20} color="#fff" />
                <Text style={styles.driverActiveRideBtnText}>Ir al viaje en curso</Text>
              </TouchableOpacity>
            ) : null}

            {driverTemplateRows.length > 0 ? (
              <View style={styles.driverTemplatesCard}>
                <Text style={styles.driverTemplatesCardTitle}>Tus rutas</Text>
                <ScrollView
                  style={styles.driverTemplateScroll}
                  contentContainerStyle={styles.favoriteStackContent}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator
                >
                  {driverTemplateRows.map((row) => {
                    const switchOn = Boolean(row.enabled && driverCardReady(row));
                    const title = row.tripDisplayName?.trim() || 'Sin nombre — tocá para configurar';
                    const metaSeats = row.publishSeatCount != null ? `${row.publishSeatCount} cupo(s)` : '—';
                    const metaGs =
                      row.totalCollectGs > 0 ? `${Math.round(row.totalCollectGs).toLocaleString('es-PY')} Gs` : '—';
                    return (
                      <TouchableOpacity
                        key={row.id}
                        style={styles.favoriteRow}
                        onPress={() => {
                          void (async () => {
                            if (!parentNav) return;
                            const publishKind =
                              row.rideKind === 'long_distance' ? 'long_distance' : 'internal';
                            if (!userId) {
                              parentNav.navigate('PublishRide', {
                                driverTemplateId: row.id,
                                publishKind,
                              });
                              return;
                            }
                            try {
                              let editRideId = '';
                              const preferredId = String(row.homeActiveRideId ?? '').trim();
                              if (preferredId) {
                                const { data: preferred } = await supabase
                                  .from('rides')
                                  .select('id, status')
                                  .eq('id', preferredId)
                                  .eq('driver_id', userId)
                                  .maybeSingle();
                                const st = String((preferred as { status?: unknown } | null)?.status ?? '');
                                if (st === 'published' || st === 'booked') {
                                  editRideId = String((preferred as { id?: unknown } | null)?.id ?? '').trim();
                                }
                              }
                              if (!editRideId) {
                                const { data: active } = await supabase
                                  .from('rides')
                                  .select('id')
                                  .eq('driver_id', userId)
                                  .eq('driver_home_template_slot', row.id)
                                  .in('status', ['published', 'booked'])
                                  .order('departure_time', { ascending: true })
                                  .limit(1);
                                editRideId = String((active?.[0] as { id?: unknown } | undefined)?.id ?? '').trim();
                              }
                              if (editRideId) {
                                parentNav.navigate('EditRide', { rideId: editRideId });
                                return;
                              }
                            } catch {
                              // fallback: abrir formulario de publicación
                            }
                            parentNav.navigate('PublishRide', {
                              driverTemplateId: row.id,
                              publishKind,
                            });
                          })();
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Plantilla ${title}`}
                      >
                        <TouchableOpacity
                          style={styles.favoriteDeleteBtn}
                          onPress={() => deleteDriverTemplate(row.id, row.tripDisplayName)}
                          accessibilityRole="button"
                          accessibilityLabel={`Eliminar plantilla ${title}`}
                        >
                          <Ionicons name="close" size={12} color="#b91c1c" />
                        </TouchableOpacity>
                        <View style={styles.favoriteRowLeft}>
                          <View style={styles.favoriteRowTitleRow}>
                            {driverTemplateHasConfig(row) && switchOn ? (
                              <View style={styles.favoriteActiveBadge}>
                                <Text style={styles.favoriteActiveBadgeText}>Activo</Text>
                              </View>
                            ) : null}
                          </View>
                          <Text style={styles.favoriteRowLabel}>{title}</Text>
                          <Text style={styles.favoriteRowTime}>
                            {driverTemplateHasConfig(row) ? driverScheduleLabel(row) : 'Sin configurar'}
                          </Text>
                          <Text style={styles.favoriteRowCostMuted}>
                            Cupos: {metaSeats} · Meta total: {metaGs}
                          </Text>
                        </View>
                        <View
                          style={styles.favoriteRowRight}
                          onStartShouldSetResponder={() => true}
                          onTouchEnd={(e) => e.stopPropagation()}
                        >
                          <Switch
                            value={switchOn}
                            onValueChange={(v) => {
                              if (!userId) return;
                              if (!v) {
                                void (async () => {
                                  const token = session?.access_token?.trim() ?? '';
                                  const { data: hits } = await supabase
                                    .from('rides')
                                    .select('id')
                                    .eq('driver_id', userId)
                                    .eq('driver_home_template_slot', row.id)
                                    .in('status', ['published', 'booked'])
                                    .order('departure_time', { ascending: true });
                                  const ids = (hits ?? [])
                                    .map((h) => String((h as { id?: string }).id ?? '').trim())
                                    .filter(Boolean);
                                  if (ids.length > 0 && !token) {
                                    Alert.alert('Sesión', 'No pudimos cancelar los viajes: iniciá sesión de nuevo.');
                                    return;
                                  }
                                  for (const rideId of ids) {
                                    const res = await updateRideStatus(rideId, 'cancelled', token);
                                    if (!res.ok) {
                                      Alert.alert(
                                        'Cancelar viaje',
                                        res.details ??
                                          res.error ??
                                          'No se pudo cancelar un viaje ligado a esta plantilla.'
                                      );
                                      return;
                                    }
                                  }
                                  await upsertDriverHomeTemplateRow(userId, row.id, {
                                    enabled: false,
                                    homeActiveRideId: null,
                                  });
                                  const rows = await loadDriverHomeTemplateRows(userId);
                                  setDriverTemplateRows(rows);
                                })();
                                return;
                              }
                              if (!driverCardReady(row)) {
                                parentNav?.navigate('PublishRide', {
                                  driverTemplateId: row.id,
                                  publishKind: row.rideKind === 'long_distance' ? 'long_distance' : 'internal',
                                });
                                return;
                              }
                              void (async () => {
                                await upsertDriverHomeTemplateRow(userId, row.id, { bumpScheduleAnchor: true });
                                const rows = await loadDriverHomeTemplateRows(userId);
                                setDriverTemplateRows(rows);
                                const fresh = getDriverHomeTemplateRow(rows, row.id);
                                parentNav?.navigate('PublishRide', {
                                  driverTemplateId: row.id,
                                  publishKind:
                                    (fresh?.rideKind ?? row.rideKind) === 'long_distance'
                                      ? 'long_distance'
                                      : 'internal',
                                  autoPublish: true,
                                });
                              })();
                            }}
                            trackColor={{ false: '#d1d5db', true: '#c6e6d3' }}
                            thumbColor={switchOn ? appBrand.colors.primary : '#f9fafb'}
                          />
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            ) : (
              <>
                <View style={styles.driverEmptyCard}>
                  <View style={styles.driverEmptyIllustration}>
                    <View style={styles.driverEmptyRouteCol}>
                      <View style={styles.driverEmptyRouteDot} />
                      <View style={styles.driverEmptyRouteLine} />
                      <View style={styles.driverEmptyRouteDotSmall} />
                    </View>
                    <Ionicons name="car-sport-outline" size={40} color={appBrand.colors.primary} />
                  </View>
                  <Text style={styles.driverEmptyTitle}>Aún no tenés viajes activos</Text>
                  <Text style={styles.driverEmptySubtitle}>
                    Publicá tu primera ruta y empezá a recibir pasajeros
                  </Text>
                  <TouchableOpacity
                    style={styles.driverEmptyCta}
                    onPress={goDriverNewRoutePublish}
                    accessibilityRole="button"
                    accessibilityLabel="Crear mi primera ruta"
                  >
                    <Ionicons name="add" size={18} color={appBrand.colors.primary} />
                    <Text style={styles.driverEmptyCtaText}>Crear mi primera ruta</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.driverHowToCard}>
                  <Text style={styles.driverHowToKicker}>{driverHomeHowTo.title}</Text>
                  {driverHomeHowTo.lines.map((line, idx) => (
                    <Text key={`howto-${idx}`} style={styles.driverHowToLine}>
                      {line}
                    </Text>
                  ))}
                </View>
              </>
            )}

            <Text style={styles.driverQuickSectionTitle}>ACCIONES RÁPIDAS</Text>
            <View style={styles.quickActionsWrap}>
              <View style={styles.quickGridRow}>
                <TouchableOpacity
                  style={styles.quickTile}
                  onPress={() => parentNav?.navigate('DriverTripRequests')}
                  accessibilityRole="button"
                  accessibilityLabel="Solicitudes de trayecto"
                >
                  {driverPendingTripRequestsBadge > 0 ? (
                    <View
                      style={styles.quickBadge}
                      accessibilityLabel={`${driverPendingTripRequestsBadge} solicitudes pendientes`}
                    >
                      <Text style={styles.quickBadgeText}>
                        {driverPendingTripRequestsBadge > 99 ? '99+' : driverPendingTripRequestsBadge}
                      </Text>
                    </View>
                  ) : null}
                  <View style={styles.quickIconSquare}>
                    <Ionicons name="document-text-outline" size={24} color={appBrand.colors.primary} />
                  </View>
                  <Text style={styles.quickTileLabel}>Solicitudes</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.quickTile}
                  onPress={() => parentNav?.navigate('MyPublishedRides')}
                  accessibilityRole="button"
                  accessibilityLabel="Mis viajes publicados"
                >
                  <View style={styles.quickIconSquare}>
                    <Ionicons name="list-outline" size={24} color={appBrand.colors.primary} />
                  </View>
                  <Text style={styles.quickTileLabel}>Mis viajes</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.quickGridRow}>
                <TouchableOpacity
                  style={styles.quickTile}
                  onPress={() => parentNav?.navigate('Messages')}
                  accessibilityRole="button"
                  accessibilityLabel="Mensajes"
                >
                  {driverHomeMessagesBadge > 0 ? (
                    <View style={styles.quickBadge} accessibilityLabel={`${driverHomeMessagesBadge} sin leer`}>
                      <Text style={styles.quickBadgeText}>
                        {driverHomeMessagesBadge > 99 ? '99+' : driverHomeMessagesBadge}
                      </Text>
                    </View>
                  ) : null}
                  <View style={styles.quickIconSquare}>
                    <Ionicons name="chatbubble-ellipses-outline" size={24} color={appBrand.colors.primary} />
                  </View>
                  <Text style={styles.quickTileLabel}>Mensajes</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.quickTile}
                  onPress={() => navigation.navigate('Settings')}
                  accessibilityRole="button"
                  accessibilityLabel="Panel conductor y cuenta"
                >
                  <View style={styles.quickIconSquare}>
                    <Ionicons name="speedometer-outline" size={24} color={appBrand.colors.primary} />
                  </View>
                  <Text style={styles.quickTileLabel}>Panel conductor</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: appBrand.colors.greenLight },
  scrollContent: { flexGrow: 1, padding: 20, paddingBottom: 32 },
  scrollPassengerPage: { backgroundColor: PASSENGER_PAGE_BG },
  scrollContentPassengerPage: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 28 },
  passengerShell: { flexGrow: 1 },
  driverShell: { flexGrow: 1 },
  driverHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  driverHeaderTextCol: { flex: 1, paddingRight: 12 },
  driverGreetingMuted: {
    fontSize: 13,
    color: '#94a3b8',
    fontFamily: appBrand.fonts.regular,
    marginBottom: 4,
  },
  driverPanelTitle: { fontSize: 24, fontWeight: '800', color: '#111827', fontFamily: appBrand.fonts.semibold },
  driverAvatarTouch: { position: 'relative' },
  driverAvatarGradient: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: appBrand.colors.primary,
  },
  driverAvatarLetterWhite: { fontSize: 20, fontWeight: '800', color: '#fff', fontFamily: appBrand.fonts.semibold },
  driverAvatarNotifyDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ef4444',
    borderWidth: 2,
    borderColor: '#fff',
  },
  driverStatsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  driverStatCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 6,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  driverStatValue: {
    fontSize: 22,
    fontWeight: '800',
    color: appBrand.colors.primary,
    fontFamily: appBrand.fonts.semibold,
  },
  driverStatLabel: { fontSize: 12, color: '#64748b', marginTop: 4, fontFamily: appBrand.fonts.regular },
  driverPrimaryGradientOuter: {
    borderRadius: 18,
    overflow: 'hidden',
    marginBottom: 14,
    shadowColor: 'rgba(26,92,56,0.28)',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 24,
    elevation: 10,
  },
  driverPrimaryGradientInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    paddingHorizontal: 18,
    backgroundColor: appBrand.colors.primary,
  },
  driverPrimaryGradientLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    fontFamily: appBrand.fonts.semibold,
  },
  driverActiveRideBtn: {
    marginBottom: 16,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: appBrand.colors.primary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  driverActiveRideBtnText: { color: '#fff', fontSize: 15, fontWeight: '800', fontFamily: appBrand.fonts.semibold },
  driverTemplatesCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 14,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  driverTemplatesCardTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#64748b',
    marginBottom: 10,
    letterSpacing: 0.6,
    fontFamily: appBrand.fonts.semibold,
  },
  driverEmptyCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 22,
    marginBottom: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#d1d5db',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  driverEmptyIllustration: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 12 },
  driverEmptyRouteCol: { alignItems: 'center', height: 72, justifyContent: 'space-between', paddingVertical: 2 },
  driverEmptyRouteDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: appBrand.colors.primaryMuted },
  driverEmptyRouteLine: { flex: 1, width: 3, backgroundColor: '#c6e6d3', marginVertical: 4, borderRadius: 2 },
  driverEmptyRouteDotSmall: { width: 6, height: 6, borderRadius: 3, backgroundColor: appBrand.colors.primary },
  driverEmptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
    fontFamily: appBrand.fonts.semibold,
  },
  driverEmptySubtitle: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 16,
    fontFamily: appBrand.fonts.regular,
  },
  driverEmptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: PASSENGER_QUICK_ICON_BG,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 14,
  },
  driverEmptyCtaText: { fontSize: 15, fontWeight: '800', color: appBrand.colors.primary, fontFamily: appBrand.fonts.semibold },
  driverHowToCard: {
    borderRadius: 20,
    padding: 18,
    marginBottom: 18,
    backgroundColor: appBrand.colors.primary,
  },
  driverHowToKicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: 'rgba(255,255,255,0.85)',
    marginBottom: 10,
    fontFamily: appBrand.fonts.semibold,
  },
  driverHowToLine: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    lineHeight: 20,
    marginBottom: 6,
    fontFamily: appBrand.fonts.semibold,
  },
  driverQuickSectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    color: '#94a3b8',
    marginBottom: 10,
    fontFamily: appBrand.fonts.semibold,
  },
  homeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  homeHeaderTextCol: { flex: 1, paddingRight: 12 },
  homeGreetingLine: { fontSize: 22, fontWeight: '700', color: '#111827', fontFamily: appBrand.fonts.semibold },
  homeGreetingQuestion: { fontSize: 15, color: '#64748b', marginTop: 4, fontFamily: appBrand.fonts.regular },
  homeAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: PASSENGER_QUICK_ICON_BG,
    borderWidth: 2,
    borderColor: '#c6e6d3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeAvatarLetter: { fontSize: 18, fontWeight: '800', color: appBrand.colors.primary, fontFamily: appBrand.fonts.semibold },
  heroCard: {
    borderRadius: 22,
    padding: 22,
    marginBottom: 18,
    backgroundColor: appBrand.colors.primary,
    overflow: 'hidden',
    minHeight: 176,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  heroBlob: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: appBrand.colors.primaryMuted,
    opacity: 0.22,
  },
  heroBlob1: { top: -48, right: -36 },
  heroBlob2: { bottom: -56, left: -44 },
  heroEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: 'rgba(255,255,255,0.72)',
    marginBottom: 8,
    fontFamily: appBrand.fonts.semibold,
  },
  heroTitle: { fontSize: 20, fontWeight: '800', color: '#fff', lineHeight: 26, fontFamily: appBrand.fonts.semibold },
  heroSubtitle: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.92)',
    marginTop: 8,
    lineHeight: 20,
    fontFamily: appBrand.fonts.regular,
  },
  heroCtaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    marginTop: 16,
    gap: 6,
  },
  heroCtaText: { fontSize: 15, fontWeight: '800', color: appBrand.colors.primary, fontFamily: appBrand.fonts.semibold },
  searchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 22,
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
  routesSectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  routesSectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.9,
    color: '#64748b',
    fontFamily: appBrand.fonts.semibold,
  },
  routesSectionAdd: { fontSize: 13, fontWeight: '800', color: appBrand.colors.primary, fontFamily: appBrand.fonts.semibold },
  routesListWrap: { marginBottom: 6 },
  passengerRouteCard: {
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
  passengerRouteCardActive: {
    borderWidth: 2,
    borderColor: '#c6e6d3',
    shadowColor: appBrand.colors.primary,
    shadowOpacity: 0.14,
    shadowRadius: 14,
    elevation: 3,
  },
  passengerRouteBody: { flex: 1, minWidth: 0, paddingRight: 6 },
  passengerRouteTopRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
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
  passengerRouteName: { fontSize: 15, fontWeight: '800', color: '#111827', fontFamily: appBrand.fonts.semibold },
  passengerRouteMeta: { fontSize: 12, color: '#6b7280', marginTop: 2, fontFamily: appBrand.fonts.regular },
  passengerRouteCost: { fontSize: 13, fontWeight: '700', color: appBrand.colors.primary, marginTop: 4, fontFamily: appBrand.fonts.semibold },
  passengerRouteCostMuted: { fontSize: 12, color: '#9ca3af', marginTop: 4, fontFamily: appBrand.fonts.regular },
  passengerRouteSwitchCol: { justifyContent: 'flex-start', paddingTop: 2 },
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
  quickActionsWrap: { marginTop: 8, marginBottom: 8 },
  quickActionsTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.9,
    color: '#64748b',
    marginBottom: 12,
    fontFamily: appBrand.fonts.semibold,
  },
  quickGridRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  quickTile: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 10,
    alignItems: 'center',
    position: 'relative',
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
    backgroundColor: PASSENGER_QUICK_ICON_BG,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  quickTileLabel: { fontSize: 13, fontWeight: '800', color: '#111827', textAlign: 'center', fontFamily: appBrand.fonts.semibold },
  quickBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  quickBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800', fontFamily: appBrand.fonts.semibold },
  activeRideShortcutBtnPassenger: {
    marginBottom: 14,
    backgroundColor: appBrand.colors.primary,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
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
  welcomePassenger: { fontSize: 20, fontWeight: '800', color: appBrand.colors.primary, marginBottom: 8, lineHeight: 26 },
  subLead: { fontSize: 14, color: '#4b5563', lineHeight: 21, marginBottom: 14 },
  bannerWarning: { backgroundColor: '#fef3c7', padding: 12, borderRadius: 8, marginBottom: 16, borderWidth: 1, borderColor: '#f59e0b' },
  bannerInfo: { backgroundColor: '#dbeafe', padding: 12, borderRadius: 8, marginBottom: 16, borderWidth: 1, borderColor: '#3b82f6' },
  bannerText: { fontSize: 14, color: '#1f2937' },
  favoritesBox: { borderWidth: 1, borderColor: '#86efac', borderRadius: 14, padding: 14, marginBottom: 16, backgroundColor: appBrand.colors.greenLight },
  favoritesPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: appBrand.colors.primary,
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
    backgroundColor: appBrand.colors.greenLight,
    borderWidth: 1,
    borderColor: '#86efac',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  favoriteActiveBadgeText: { fontSize: 11, fontWeight: '700', color: appBrand.colors.primary },
  favoriteStackScroll: { maxHeight: 360 },
  favoriteStackContent: { gap: 8, paddingBottom: 4 },
  favoriteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: appBrand.colors.greenLight,
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
  favoriteRowLabel: { fontSize: 13, fontWeight: '700', color: appBrand.colors.primary, marginTop: 4 },
  favoriteRowTime: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  favoriteRowCost: { fontSize: 12, color: appBrand.colors.primary, marginTop: 2, fontWeight: '700' },
  favoriteRowCostMuted: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  driverTemplateScroll: { maxHeight: 360, marginBottom: 4 },
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
    backgroundColor: PASSENGER_QUICK_ICON_BG,
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
    backgroundColor: appBrand.colors.greenLight,
    borderWidth: 1,
    borderColor: '#86efac',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnMintInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnMintText: { fontSize: 14, fontWeight: '700', color: appBrand.colors.primary },
  activeRideShortcutBtn: {
    marginBottom: 12,
    backgroundColor: '#1d4ed8',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  activeRideShortcutBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
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
  activateModalToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 8,
  },
  activateModalToggleTextWrap: { flex: 1, minWidth: 0 },
  activateModalToggleTitle: { fontSize: 13, fontWeight: '700', color: appBrand.colors.primary },
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
  activateModalBtnPrimary: { backgroundColor: appBrand.colors.primary },
  activateModalBtnPrimaryDisabled: { opacity: 0.55 },
  activateModalBtnPrimaryText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
