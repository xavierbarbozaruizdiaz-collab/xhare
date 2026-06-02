/**
 * Conductor: publicar viaje (mapa, fecha/hora, flexibilidad, asientos del vehículo, descripción).
 * Alineado al flujo de web `src/app/publish/page.tsx`: insert en `rides` + `ride_stops`, vincular `trip_requests`.
 */
import { appBrand } from '../ui/theme/brand';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  Switch,
} from 'react-native';
import MapView, { Polyline, Marker, type MapPressEvent } from 'react-native-maps';
import DateTimePicker from '@react-native-community/datetimepicker';
import { androidMapProvider } from '../lib/androidMapProvider';
import { useNavigation, useRoute, useFocusEffect, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../backend/supabase';
import { searchAddresses, reverseGeocodeStructured, type GeocodeSuggestion } from '../backend/geocodeApi';
import { fetchRoute } from '../backend/routeApi';
import { buildRideIdToDemandGroupMap, fetchDemandRouteDetail } from '../backend/demandRoutesApi';
import { env } from '../core/env';
import { getAppFlavor } from '../core/flavor';
import { getPositionAlongPolyline, snapToPolyline, type Point as GeoPoint } from '../lib/geo';
import { datePickerDisplay, timePickerDisplay } from '../lib/datePickerUi';
import { PublishRouteMapModal, type PublishMapMode } from '../components/PublishRouteMapModal';
import type { MainStackParamList } from '../navigation/types';
import { MAX_DRIVER_PUBLISH_WAYPOINTS } from '../core/publishRouteLimits';
import {
  loadDriverHomeTemplateRows,
  getDriverHomeTemplateRow,
  upsertDriverHomeTemplateRow,
  newDriverTemplateId,
} from '../lib/driverHomeTemplates';
import {
  coerceScheduleWeekdayMask,
  SCHEDULE_WEEKDAY_MASK_ALL,
  computeNextTriggerIso,
} from '../lib/passengerFavorites';
import { addDaysToYmd } from '../lib/bookingLead';

/** Debounce al recalcular ruta por calles al mover ajustes de ruta. */
const PUBLISH_ROUTE_DEBOUNCE_MS = 220;

type Nav = NativeStackNavigationProp<MainStackParamList, 'PublishRide'>;
type ScreenRoute = RouteProp<MainStackParamList, 'PublishRide'>;
type PublishKind = 'internal' | 'long_distance';

type Point = { lat: number; lng: number; label?: string };
type PassengerFixedPoint = {
  lat: number;
  lng: number;
  label: string;
  role?: 'first_pickup' | 'last_dropoff' | 'normal';
};

type UserProfile = {
  role: string;
  vehicle_seat_count: number;
  vehicle_model: string;
  vehicle_year: string | number | null;
  vehicle_seat_layout: unknown;
  driver_approved_at: string | null;
};

const GREEN = appBrand.colors.primary;

const WEEKDAY_TOGGLE_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const;

/** Viajes adicionales (mismo tramo) cuando la plantilla es diaria + días de semana (solo interno). */
const DRIVER_RECURRING_MAX_EXTRA = 14;

function formatTimeHhMm(t: string | null | undefined): string {
  if (!t) return '08:00';
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '08:00';
}

function regionForPoints(points: Point[]) {
  if (points.length === 0) {
    return { latitude: -25.3, longitude: -57.6, latitudeDelta: 0.35, longitudeDelta: 0.35 };
  }
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const pad = 0.012;
  return {
    latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
    longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    latitudeDelta: Math.max(0.04, Math.max(...lats) - Math.min(...lats) + pad * 2),
    longitudeDelta: Math.max(0.04, Math.max(...lngs) - Math.min(...lngs) + pad * 2),
  };
}

/** Región del modal: origen, destino y ajustes (no todos los vértices de la polyline). */
function regionForPublishFocus(
  origin: Point | null,
  destination: Point | null,
  waypoints: Point[],
  passengerFixedPoints: PassengerFixedPoint[]
) {
  const pts: Point[] = [];
  if (origin) pts.push(origin);
  if (destination) pts.push(destination);
  waypoints.forEach((w) => pts.push(w));
  passengerFixedPoints.forEach((p) => pts.push({ lat: p.lat, lng: p.lng, label: p.label }));
  if (pts.length === 0) {
    return { latitude: -25.3, longitude: -57.6, latitudeDelta: 0.35, longitudeDelta: 0.35 };
  }
  const r = regionForPoints(pts);
  return {
    ...r,
    latitudeDelta: Math.min(Math.max(r.latitudeDelta, 0.028), 0.42),
    longitudeDelta: Math.min(Math.max(r.longitudeDelta, 0.028), 0.42),
  };
}

function toLocalYyyyMmDd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatSupabaseError(error: unknown): string {
  if (error == null) return 'Error desconocido';
  const e = error as Record<string, unknown>;
  const parts = [String(e.message ?? e.error_description ?? '')];
  if (e.code) parts.push(`Código: ${e.code}`);
  if (e.details) parts.push(typeof e.details === 'string' ? e.details : JSON.stringify(e.details));
  return parts.filter(Boolean).join('\n');
}

export function PublishRideScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<ScreenRoute>();
  const { session } = useAuth();
  const params = route.params ?? {};
  const tripRequestIdParam = params.tripRequestId;
  const fromRideIdParam = params.fromRideId;
  const groupIdParam = params.groupId;
  const groupSuggestedPickupTimeParam =
    typeof params.groupSuggestedPickupTime === 'string' ? params.groupSuggestedPickupTime : undefined;
  const driverTemplateIdParam =
    typeof params.driverTemplateId === 'string' && params.driverTemplateId.trim()
      ? params.driverTemplateId.trim()
      : undefined;
  const createDriverTemplateParam = params.createDriverTemplate === true;
  const autoPublishParam = params.autoPublish === true;
  const isDriverApp = getAppFlavor() === 'driver';
  /**
   * Si entrás solo con `fromRideId` (viaje awaiting_driver) pero ese ride está ligado a un grupo en
   * `demand_route_groups`, el flujo real es el mismo que con `groupId` en ruta.
   */
  const [prefillResolvedGroupId, setPrefillResolvedGroupId] = useState<string | null>(null);
  /** Si venís de solicitud / ruta con demanda / copiar viaje, el tipo lo fija ese flujo. */
  const contextualPublish = Boolean(tripRequestIdParam || groupIdParam || fromRideIdParam);
  const paramPublishKind: PublishKind =
    params.publishKind === 'long_distance' ? 'long_distance' : 'internal';
  const [publishKindFree, setPublishKindFree] = useState<PublishKind>(paramPublishKind);
  const publishKind = contextualPublish ? paramPublishKind : publishKindFree;
  const isLongDistance = publishKind === 'long_distance';
  const suggestedSeatPriceGsParam =
    params.suggestedSeatPriceGs != null && Number.isFinite(params.suggestedSeatPriceGs)
      ? Math.round(Number(params.suggestedSeatPriceGs))
      : null;

  const [gateLoading, setGateLoading] = useState(true);
  const [prefillLoading, setPrefillLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [driverSuspended, setDriverSuspended] = useState(false);

  const [origin, setOrigin] = useState<Point | null>(null);
  const [destination, setDestination] = useState<Point | null>(null);
  const [originInput, setOriginInput] = useState('');
  const [destinationInput, setDestinationInput] = useState('');
  const [originSuggestions, setOriginSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [destinationSuggestions, setDestinationSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [showOriginSuggestions, setShowOriginSuggestions] = useState(false);
  const [showDestinationSuggestions, setShowDestinationSuggestions] = useState(false);

  const [departureDate, setDepartureDate] = useState('');
  const [departureTime, setDepartureTime] = useState('08:00');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [departureFlexibility, setDepartureFlexibility] = useState<'strict_5' | 'flexible_30'>('strict_5');
  const [routeName, setRouteName] = useState('');
  /** Cupos a publicar (ofertas): ≤ vehículo; el valor inicial real viene del perfil en `loadGate`. */
  const [publishSeatCount, setPublishSeatCount] = useState(1);
  /** Meta de recaudación total (Gs), referencia en plantilla y descripción. */
  const [totalCollectGsInput, setTotalCollectGsInput] = useState('');
  /** Reprogramación diaria (plantilla conductor). */
  const [templateScheduleDaily, setTemplateScheduleDaily] = useState(false);
  /** Días de la semana en que aplica la plantilla diaria (bits 0=dom … 6=sáb). */
  const [templateWeekdayMask, setTemplateWeekdayMask] = useState(SCHEDULE_WEEKDAY_MASK_ALL);
  const [manualSeatPriceInput, setManualSeatPriceInput] = useState('');
  const [routePolyline, setRoutePolyline] = useState<Point[]>([]);
  const [durationMin, setDurationMin] = useState(60);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [tripRequestIdsToLink, setTripRequestIdsToLink] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  /** Paradas intermedias en el mapa; `label` se muestra en el formulario y en ride_stops. */
  const [waypoints, setWaypoints] = useState<Point[]>([]);
  const [passengerFixedPoints, setPassengerFixedPoints] = useState<PassengerFixedPoint[]>([]);
  const [publishMapMode, setPublishMapMode] = useState<PublishMapMode>('origin');
  const [mapModalVisible, setMapModalVisible] = useState(false);
  const isGroupedPublishFlow = Boolean(groupIdParam || prefillResolvedGroupId);
  const [groupFirstPickupPoint, setGroupFirstPickupPoint] = useState<{ lat: number; lng: number } | null>(null);
  /** Ride de despacho ya existente para el grupo (p. ej. tras cancelación → awaiting_driver). */
  const [existingGroupRideId, setExistingGroupRideId] = useState<string | null>(null);

  /** Auto-publicar desde Inicio (plantilla lista): una vez al cumplirse condiciones. */
  const handlePublishRef = useRef<(() => Promise<void>) | null>(null);
  const autoPublishOnceRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      return () => {
        autoPublishOnceRef.current = false;
      };
    }, [])
  );

  /** Origen de tiempos para logs [perf][PublishRide] (solo __DEV__). */
  const publishPerfT0 = useRef(0);
  useEffect(() => {
    if (!__DEV__) return;
    publishPerfT0.current = Date.now();
    console.log('[perf][PublishRide] screen mounted');
  }, []);

  const mapRegion = useMemo(
    () => regionForPublishFocus(origin, destination, waypoints, passengerFixedPoints),
    [origin, destination, waypoints, passengerFixedPoints]
  );
  const polylineCoords = useMemo(
    () => routePolyline.map((p) => ({ latitude: p.lat, longitude: p.lng })),
    [routePolyline]
  );

  const waypointsRouteKey = useMemo(
    () => waypoints.map((w) => `${w.lat},${w.lng}`).join(';'),
    [waypoints]
  );
  const passengerFixedRouteKey = useMemo(
    () => passengerFixedPoints.map((p) => `${p.lat},${p.lng}`).join(';'),
    [passengerFixedPoints]
  );
  const [linkedPassengerSeatSum, setLinkedPassengerSeatSum] = useState(0);
  const linkedPassengerSeats = useMemo(
    () => (isGroupedPublishFlow ? linkedPassengerSeatSum : 0),
    [isGroupedPublishFlow, linkedPassengerSeatSum]
  );

  const groupTargetPickupDateTime = useMemo(() => {
    if (!isGroupedPublishFlow) return null;
    if (!departureDate || !groupSuggestedPickupTimeParam) return null;
    const d = new Date(`${departureDate}T${formatTimeHhMm(groupSuggestedPickupTimeParam)}:00`);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }, [isGroupedPublishFlow, departureDate, groupSuggestedPickupTimeParam]);

  const loadGate = useCallback(async () => {
    if (!session?.id) {
      setGateLoading(false);
      return;
    }
    setGateLoading(true);
    const gateStartedAt = __DEV__ ? Date.now() : 0;
    const [profileResult, accountResult] = await Promise.all([
      supabase
        .from('profiles')
        .select('role, vehicle_seat_count, vehicle_model, vehicle_year, vehicle_seat_layout, driver_approved_at')
        .eq('id', session.id)
        .maybeSingle(),
      supabase.from('driver_accounts').select('account_status, operational_blocked_until').eq('driver_id', session.id).maybeSingle(),
    ]);
    const { data: profile, error: pErr } = profileResult;
    const { data: account } = accountResult;

    if (pErr || !profile) {
      Alert.alert('Sesión', 'No se pudo cargar tu perfil.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
      setGateLoading(false);
      return;
    }

    if (profile.role === 'driver_pending' || (profile.role === 'driver' && !profile.driver_approved_at)) {
      Alert.alert('Conductor', 'Tu cuenta aún no está aprobada para publicar.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
      setGateLoading(false);
      return;
    }

    if (profile.role !== 'driver') {
      Alert.alert('Acceso', 'Solo los conductores pueden publicar viajes.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
      setGateLoading(false);
      return;
    }

    if (profile.vehicle_seat_count == null || !String(profile.vehicle_model ?? '').trim() || profile.vehicle_year == null) {
      Alert.alert(
        'Vehículo',
        'Tu vehículo aún no está cargado en la plataforma. Un administrador debe registrar o actualizar modelo, año y asientos desde el panel web.',
        [{ text: 'Volver', onPress: () => navigation.goBack() }]
      );
      setGateLoading(false);
      return;
    }

    const opUntil = account?.operational_blocked_until ? Date.parse(String(account.operational_blocked_until)) : NaN;
    const opActive = !Number.isNaN(opUntil) && opUntil > Date.now();
    setDriverSuspended(account?.account_status === 'suspended' || opActive);

    const seatCap = Math.max(1, Number(profile.vehicle_seat_count));
    setUserProfile({
      role: profile.role,
      vehicle_seat_count: seatCap,
      vehicle_model: String(profile.vehicle_model ?? ''),
      vehicle_year: profile.vehicle_year,
      vehicle_seat_layout: profile.vehicle_seat_layout ?? { rows: [Number(profile.vehicle_seat_count)] },
      driver_approved_at: profile.driver_approved_at,
    });
    setPublishSeatCount(seatCap);
    if (__DEV__ && gateStartedAt) {
      const now = Date.now();
      console.log('[perf][PublishRide] loadGate total ms (queries+validation)', now - gateStartedAt);
      if (publishPerfT0.current) {
        console.log('[perf][PublishRide] ms from screen mount to gate done', now - publishPerfT0.current);
      }
    }
    setGateLoading(false);
  }, [session?.id, navigation]);

  useEffect(() => {
    loadGate();
  }, [loadGate]);

  useEffect(() => {
    if (!userProfile) return;
    const cap = Math.max(1, userProfile.vehicle_seat_count);
    setPublishSeatCount((c) => Math.min(Math.max(1, c), cap));
  }, [userProfile]);

  useEffect(() => {
    if (!driverTemplateIdParam || !session?.id || !userProfile) return;
    if (tripRequestIdParam || groupIdParam || fromRideIdParam) return;
    let cancelled = false;
    void (async () => {
      const rows = await loadDriverHomeTemplateRows(session.id);
      if (cancelled) return;
      const row = getDriverHomeTemplateRow(rows, driverTemplateIdParam);
      if (!row) {
        if (paramPublishKind === 'long_distance') setPublishKindFree('long_distance');
        return;
      }
      if (row.tripDisplayName.trim()) setRouteName(row.tripDisplayName.trim().slice(0, 100));
      const cap = Math.max(1, userProfile.vehicle_seat_count);
      setPublishSeatCount(Math.min(Math.max(1, row.publishSeatCount || cap), cap));
      if (row.departureTimeHm) setDepartureTime(formatTimeHhMm(row.departureTimeHm));
      if (row.departureDateYmd) setDepartureDate(row.departureDateYmd);
      setTemplateScheduleDaily(Boolean(row.scheduleDaily));
      setTemplateWeekdayMask(coerceScheduleWeekdayMask(row.scheduleWeekdayMask));
      if (row.rideKind === 'long_distance') {
        setPublishKindFree('long_distance');
        if (row.totalCollectGs > 0) setTotalCollectGsInput(String(Math.round(row.totalCollectGs)));
        else setTotalCollectGsInput('');
      } else {
        setPublishKindFree('internal');
        setTotalCollectGsInput('');
      }
      if (row.originLat != null && row.originLng != null) {
        setOrigin({ lat: row.originLat, lng: row.originLng, label: row.origin?.trim() || undefined });
        setOriginInput(String(row.origin ?? ''));
      }
      if (row.destinationLat != null && row.destinationLng != null) {
        setDestination({
          lat: row.destinationLat,
          lng: row.destinationLng,
          label: row.destination?.trim() || undefined,
        });
        setDestinationInput(String(row.destination ?? ''));
      }
      setWaypoints(
        Array.isArray(row.waypoints)
          ? row.waypoints
              .map((w) => ({
                lat: Number(w.lat),
                lng: Number(w.lng),
                label: w.label != null ? String(w.label) : undefined,
              }))
              .filter((w) => Number.isFinite(w.lat) && Number.isFinite(w.lng))
          : []
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [
    driverTemplateIdParam,
    session?.id,
    userProfile,
    tripRequestIdParam,
    groupIdParam,
    fromRideIdParam,
    paramPublishKind,
  ]);

  /** Con diario activo, la fecha de este viaje sigue la próxima instancia según máscara y hora. */
  useEffect(() => {
    if (!isDriverApp || isGroupedPublishFlow || !templateScheduleDaily) return;
    const mask = coerceScheduleWeekdayMask(templateWeekdayMask);
    if (mask === 0) return;
    const anchor = toLocalYyyyMmDd(new Date());
    const hm = formatTimeHhMm(departureTime);
    const iso = computeNextTriggerIso(new Date(), anchor, hm, true, mask);
    if (!iso) return;
    const nextYmd = toLocalYyyyMmDd(new Date(iso));
    setDepartureDate((prev) => (prev === nextYmd ? prev : nextYmd));
  }, [
    isDriverApp,
    isGroupedPublishFlow,
    templateScheduleDaily,
    templateWeekdayMask,
    departureTime,
  ]);

  useEffect(() => {
    if (!env.apiBaseUrl?.trim()) return;
    const t = setTimeout(async () => {
      if (originInput.trim().length < 3) {
        setOriginSuggestions([]);
        return;
      }
      const list = await searchAddresses(originInput, 5);
      setOriginSuggestions(list);
    }, 400);
    return () => clearTimeout(t);
  }, [originInput]);

  useEffect(() => {
    if (!env.apiBaseUrl?.trim()) return;
    const t = setTimeout(async () => {
      if (destinationInput.trim().length < 3) {
        setDestinationSuggestions([]);
        return;
      }
      const list = await searchAddresses(destinationInput, 5);
      setDestinationSuggestions(list);
    }, 400);
    return () => clearTimeout(t);
  }, [destinationInput]);

  const applyPrefill = useCallback(async () => {
    if (!session?.id || !userProfile) return;
    setPrefillLoading(true);
    setFormError(null);
    try {
      if (!isLongDistance) setTotalCollectGsInput('');
      setPrefillResolvedGroupId(null);

      let activeGroupId: string | undefined =
        groupIdParam != null && String(groupIdParam).trim() !== '' ? String(groupIdParam).trim() : undefined;
      if (!activeGroupId && fromRideIdParam) {
        const rid = String(fromRideIdParam).trim();
        if (rid) {
          const byRide = await buildRideIdToDemandGroupMap([rid]);
          const gid = byRide[rid];
          if (gid) activeGroupId = gid;
        }
      }

      if (activeGroupId) {
        if (!groupIdParam) {
          setPrefillResolvedGroupId(activeGroupId);
        }
        setExistingGroupRideId(null);
        setLinkedPassengerSeatSum(0);
        const { detail, error: dErr } = await fetchDemandRouteDetail(activeGroupId);
        if (dErr) setFormError(dErr);
        if (detail) {
          // En publicación desde grupo: origen/destino los define el conductor en el mapa.
          // No prellenar con puntos de pasajeros para evitar confusión visual/operativa.
          setOrigin(null);
          setDestination(null);
          setOriginInput('');
          setDestinationInput('');
          setWaypoints([]);
          const ids = (detail.passengers ?? []).map((p) => p.trip_request_id).filter(Boolean);
          setTripRequestIdsToLink(ids);
          const seatsFromSummary = Number(detail.financial_summary?.grouped_seats_taken ?? 0);
          if (Number.isFinite(seatsFromSummary) && seatsFromSummary > 0) {
            setLinkedPassengerSeatSum(Math.round(seatsFromSummary));
          } else if (ids.length > 0) {
            const { data: seatRows } = await supabase.from('trip_requests').select('seats').in('id', ids);
            let sum = 0;
            for (const row of seatRows ?? []) {
              const s = Number((row as { seats?: number }).seats ?? 1);
              sum += Number.isFinite(s) && s > 0 ? s : 1;
            }
            setLinkedPassengerSeatSum(sum > 0 ? sum : ids.length);
          } else {
            setLinkedPassengerSeatSum(0);
          }

          const { data: groupRow } = await supabase
            .from('demand_route_groups')
            .select('ride_id')
            .eq('id', activeGroupId)
            .maybeSingle();
          const gidRide = groupRow?.ride_id != null ? String(groupRow.ride_id) : '';
          if (gidRide) {
            const { data: sysRide } = await supabase
              .from('rides')
              .select('id, status, driver_id')
              .eq('id', gidRide)
              .maybeSingle();
            const st = String((sysRide as { status?: string } | null)?.status ?? '');
            const drv = (sysRide as { driver_id?: string | null } | null)?.driver_id;
            if (st === 'awaiting_driver' && (drv == null || String(drv).trim() === '')) {
              setExistingGroupRideId(gidRide);
            } else {
              setExistingGroupRideId(null);
            }
          } else {
            setExistingGroupRideId(null);
          }

          const orderedLegs = [...(detail.legs ?? [])].sort(
            (a, b) => Number(a.visit_order ?? 0) - Number(b.visit_order ?? 0)
          );
          const firstPickup = orderedLegs.find((l) => String(l.stop_type).toUpperCase() === 'PICKUP');
          const lastDropoff = [...orderedLegs]
            .reverse()
            .find((l) => String(l.stop_type).toUpperCase() === 'DROPOFF');
          const firstPickupKey =
            firstPickup && Number.isFinite(Number(firstPickup.lat)) && Number.isFinite(Number(firstPickup.lng))
              ? `${Number(firstPickup.lat).toFixed(6)}|${Number(firstPickup.lng).toFixed(6)}|PICKUP`
              : null;
          const lastDropoffKey =
            lastDropoff && Number.isFinite(Number(lastDropoff.lat)) && Number.isFinite(Number(lastDropoff.lng))
              ? `${Number(lastDropoff.lat).toFixed(6)}|${Number(lastDropoff.lng).toFixed(6)}|DROPOFF`
              : null;
          const fixed = new Map<string, PassengerFixedPoint>();
          const firstPickupLeg = [...(detail.legs ?? [])]
            .filter((l) => String(l.stop_type).toUpperCase() === 'PICKUP')
            .sort((a, b) => Number(a.visit_order ?? 0) - Number(b.visit_order ?? 0))[0];
          if (
            firstPickupLeg &&
            Number.isFinite(Number(firstPickupLeg.lat)) &&
            Number.isFinite(Number(firstPickupLeg.lng))
          ) {
            setGroupFirstPickupPoint({
              lat: Number(firstPickupLeg.lat),
              lng: Number(firstPickupLeg.lng),
            });
          } else {
            setGroupFirstPickupPoint(null);
          }
          for (const leg of detail.legs ?? []) {
            if (typeof leg.lat !== 'number' || typeof leg.lng !== 'number') continue;
            const stopType = String(leg.stop_type ?? '').toUpperCase();
            const key = `${leg.lat.toFixed(6)}|${leg.lng.toFixed(6)}|${stopType}`;
            if (!fixed.has(key)) {
              const stopLabel = stopType === 'DROPOFF' ? 'Bajada' : 'Subida';
              const role: PassengerFixedPoint['role'] =
                key === firstPickupKey
                  ? 'first_pickup'
                  : key === lastDropoffKey
                    ? 'last_dropoff'
                    : 'normal';
              fixed.set(key, {
                lat: Number(leg.lat),
                lng: Number(leg.lng),
                label: `${stopLabel}: ${String(leg.label ?? 'Punto de pasajero')}`,
                role,
              });
            }
          }
          if (fixed.size === 0 && (detail.passengers ?? []).length > 0) {
            const shortId = (id: string) => String(id).slice(0, 6);
            const pickups: Array<{ lat: number; lng: number; label: string; tripId: string }> = [];
            const dropoffs: Array<{ lat: number; lng: number; label: string; tripId: string }> = [];
            for (const p of detail.passengers ?? []) {
              const tid = String(p.trip_request_id ?? '').trim();
              if (!tid) continue;
              if (Number.isFinite(p.origin_lat) && Number.isFinite(p.origin_lng)) {
                pickups.push({
                  lat: Number(p.origin_lat),
                  lng: Number(p.origin_lng),
                  label: String(p.origin_label ?? 'Origen pasajero'),
                  tripId: tid,
                });
              }
              if (Number.isFinite(p.destination_lat) && Number.isFinite(p.destination_lng)) {
                dropoffs.push({
                  lat: Number(p.destination_lat),
                  lng: Number(p.destination_lng),
                  label: String(p.destination_label ?? 'Destino pasajero'),
                  tripId: tid,
                });
              }
            }
            const firstPk =
              firstPickupLeg &&
              Number.isFinite(Number(firstPickupLeg.lat)) &&
              Number.isFinite(Number(firstPickupLeg.lng))
                ? { lat: Number(firstPickupLeg.lat), lng: Number(firstPickupLeg.lng) }
                : pickups[0] != null
                  ? { lat: pickups[0].lat, lng: pickups[0].lng }
                  : null;
            const lastDf =
              lastDropoff &&
              Number.isFinite(Number(lastDropoff.lat)) &&
              Number.isFinite(Number(lastDropoff.lng))
                ? { lat: Number(lastDropoff.lat), lng: Number(lastDropoff.lng) }
                : dropoffs.length > 0
                  ? { lat: dropoffs[dropoffs.length - 1].lat, lng: dropoffs[dropoffs.length - 1].lng }
                  : null;
            for (const pk of pickups) {
              const key = `${pk.lat.toFixed(6)}|${pk.lng.toFixed(6)}|PICKUP`;
              if (fixed.has(key)) continue;
              const isFirst =
                firstPk != null && Math.abs(pk.lat - firstPk.lat) < 1e-5 && Math.abs(pk.lng - firstPk.lng) < 1e-5;
              fixed.set(key, {
                lat: pk.lat,
                lng: pk.lng,
                label: `Subida (${shortId(pk.tripId)}): ${pk.label}`,
                role: isFirst ? 'first_pickup' : 'normal',
              });
            }
            for (const df of dropoffs) {
              const key = `${df.lat.toFixed(6)}|${df.lng.toFixed(6)}|DROPOFF`;
              if (fixed.has(key)) continue;
              const isLast =
                lastDf != null && Math.abs(df.lat - lastDf.lat) < 1e-5 && Math.abs(df.lng - lastDf.lng) < 1e-5;
              fixed.set(key, {
                lat: df.lat,
                lng: df.lng,
                label: `Bajada (${shortId(df.tripId)}): ${df.label}`,
                role: isLast ? 'last_dropoff' : 'normal',
              });
            }
          }
          setPassengerFixedPoints(Array.from(fixed.values()));
          if (detail.requested_date) setDepartureDate(detail.requested_date);
          if (groupSuggestedPickupTimeParam) {
            setDepartureTime(formatTimeHhMm(groupSuggestedPickupTimeParam));
          } else if (detail.requested_time) {
            setDepartureTime(formatTimeHhMm(detail.requested_time));
          }
        }
        return;
      }

      if (fromRideIdParam) {
        // Viaje de sistema sin fila en demand_route_groups: publicación libre, sin pasajeros agrupados.
        setPrefillResolvedGroupId(null);
        setOrigin(null);
        setDestination(null);
        setOriginInput('');
        setDestinationInput('');
        setWaypoints([]);
        setRouteName('');
        setTripRequestIdsToLink([]);
        setPassengerFixedPoints([]);
        setGroupFirstPickupPoint(null);
        setExistingGroupRideId(null);
        setLinkedPassengerSeatSum(0);
        return;
      }

      if (tripRequestIdParam) {
        setPrefillResolvedGroupId(null);
        setExistingGroupRideId(null);
        setLinkedPassengerSeatSum(0);
        const { data: rows } = await supabase
          .from('trip_requests')
          .select(
            'id, origin_lat, origin_lng, origin_label, destination_lat, destination_lng, destination_label, requested_date, requested_time, pricing_kind, passenger_desired_price_per_seat_gs'
          )
          .eq('id', tripRequestIdParam)
          .in('status', ['pending', 'grouped', 'grouping']);
        const first = rows?.[0] as
          | {
              id: string;
              origin_lat: number;
              origin_lng: number;
              origin_label: string | null;
              destination_lat: number;
              destination_lng: number;
              destination_label: string | null;
              requested_date: string;
              requested_time: string | null;
              pricing_kind?: string | null;
              passenger_desired_price_per_seat_gs?: number | null;
            }
          | undefined;
        if (first) {
          setOrigin({
            lat: first.origin_lat,
            lng: first.origin_lng,
            label: first.origin_label ?? undefined,
          });
          setOriginInput(String(first.origin_label ?? ''));
          setDestination({
            lat: first.destination_lat,
            lng: first.destination_lng,
            label: first.destination_label ?? undefined,
          });
          setDestinationInput(String(first.destination_label ?? ''));
          if (first.requested_date) setDepartureDate(first.requested_date);
          setDepartureTime(formatTimeHhMm(first.requested_time as string | null));
          setTripRequestIdsToLink([first.id]);
          if (
            isLongDistance &&
            suggestedSeatPriceGsParam == null &&
            first.passenger_desired_price_per_seat_gs != null &&
            Number(first.passenger_desired_price_per_seat_gs) >= 1000
          ) {
            setManualSeatPriceInput(String(Math.round(Number(first.passenger_desired_price_per_seat_gs))));
          }
        } else {
          setTripRequestIdsToLink([]);
        }
        setPassengerFixedPoints([]);
        return;
      }

      setPrefillResolvedGroupId(null);
      setTripRequestIdsToLink([]);
      setPassengerFixedPoints([]);
      setGroupFirstPickupPoint(null);
      setExistingGroupRideId(null);
      setLinkedPassengerSeatSum(0);
    } finally {
      setPrefillLoading(false);
    }
  }, [
    session?.id,
    userProfile,
    fromRideIdParam,
    groupIdParam,
    tripRequestIdParam,
    isLongDistance,
    suggestedSeatPriceGsParam,
    groupSuggestedPickupTimeParam,
  ]);

  useEffect(() => {
    if (!isGroupedPublishFlow) return;
    if (!origin || !groupFirstPickupPoint || !groupTargetPickupDateTime) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        const r = await fetchRoute(
          { lat: origin.lat, lng: origin.lng },
          { lat: groupFirstPickupPoint.lat, lng: groupFirstPickupPoint.lng },
          [],
          { signal: abort.signal }
        );
        if (r.aborted) return;
        const travelMin =
          Number.isFinite(Number(r.durationMinutes)) && Number(r.durationMinutes) > 0
            ? Math.round(Number(r.durationMinutes))
            : null;
        if (travelMin == null) return;
        const departAt = new Date(groupTargetPickupDateTime.getTime() - travelMin * 60_000);
        const hh = String(departAt.getHours()).padStart(2, '0');
        const mm = String(departAt.getMinutes()).padStart(2, '0');
        setDepartureTime(`${hh}:${mm}`);
      })();
    }, 180);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [isGroupedPublishFlow, origin?.lat, origin?.lng, groupFirstPickupPoint, groupTargetPickupDateTime]);

  useEffect(() => {
    if (!isGroupedPublishFlow) return;
    if (waypoints.length > 0) setWaypoints([]);
  }, [isGroupedPublishFlow, waypoints.length]);

  useEffect(() => {
    if (!userProfile) return;
    void applyPrefill();
  }, [
    userProfile,
    tripRequestIdParam,
    groupIdParam,
    fromRideIdParam,
    groupSuggestedPickupTimeParam,
    applyPrefill,
  ]);

  useEffect(() => {
    if (
      suggestedSeatPriceGsParam != null &&
      suggestedSeatPriceGsParam >= 1000 &&
      isLongDistance
    ) {
      setManualSeatPriceInput(String(suggestedSeatPriceGsParam));
    }
  }, [suggestedSeatPriceGsParam, isLongDistance]);

  useEffect(() => {
    if (!isLongDistance) setDepartureFlexibility('strict_5');
  }, [isLongDistance]);

  useEffect(() => {
    if (!origin || !destination) setWaypoints([]);
  }, [origin?.lat, origin?.lng, destination?.lat, destination?.lng]);

  useEffect(() => {
    if (!origin || !destination) {
      setRoutePolyline([]);
      setDistanceKm(null);
      return;
    }
    const chord: GeoPoint[] = [
      { lat: origin.lat, lng: origin.lng },
      { lat: destination.lat, lng: destination.lng },
    ];
    const fixedPassengerWps = passengerFixedPoints.map((p) => ({ lat: p.lat, lng: p.lng, label: p.label }));
    const orderedWps = [...waypoints, ...fixedPassengerWps].sort(
      (a, b) => getPositionAlongPolyline(a, chord) - getPositionAlongPolyline(b, chord)
    );
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        const r = await fetchRoute(
          { lat: origin.lat, lng: origin.lng },
          { lat: destination.lat, lng: destination.lng },
          orderedWps.map((w) => ({ lat: w.lat, lng: w.lng })),
          { signal: abort.signal }
        );
        if (r.aborted) return;
        if (r.fallback) {
          setRoutePolyline([]);
          setFormError(
            (prev) =>
              prev ?? 'No hay ruta por calles disponible ahora. Reintentá en unos segundos o ajustá los puntos.'
          );
          if (r.durationMinutes != null) setDurationMin(Math.max(15, Math.min(1440, r.durationMinutes)));
          if (r.distanceKm != null) setDistanceKm(r.distanceKm);
          return;
        }
        const hasLine = Boolean(r.polyline && r.polyline.length >= 2);
        if (hasLine) {
          setRoutePolyline(r.polyline!);
          if (r.durationMinutes != null) setDurationMin(Math.max(15, Math.min(1440, r.durationMinutes)));
          if (r.distanceKm != null) setDistanceKm(r.distanceKm);
          return;
        }
        if (r.error) {
          setRoutePolyline([]);
          setFormError((prev) =>
            prev ??
            r.error ??
            'No se pudo obtener ruta por calles. Reintentá en unos segundos.'
          );
          return;
        }
        setRoutePolyline([]);
        setFormError((prev) =>
          prev ?? 'No se pudo obtener ruta por calles. Reintentá en unos segundos.'
        );
      })();
    }, PUBLISH_ROUTE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [origin?.lat, origin?.lng, destination?.lat, destination?.lng, waypointsRouteKey, passengerFixedRouteKey]);

  const selectSuggestion = (s: GeocodeSuggestion, kind: 'origin' | 'destination') => {
    const point: Point = {
      lat: parseFloat(s.lat),
      lng: parseFloat(s.lon),
      label: s.display_name,
    };
    setWaypoints([]);
    if (kind === 'origin') {
      setOrigin(point);
      setOriginInput(s.display_name);
      setShowOriginSuggestions(false);
    } else {
      setDestination(point);
      setDestinationInput(s.display_name);
      setShowDestinationSuggestions(false);
    }
  };

  const openMapPicker = (mode: PublishMapMode) => {
    if (isGroupedPublishFlow && mode === 'waypoint') {
      Alert.alert('Ajustes de ruta', 'En publicación desde ruta con demanda no se pueden agregar ajustes de ruta manuales.');
      return;
    }
    if (mode === 'waypoint' && (!origin || !destination)) {
      Alert.alert('Ruta', 'Definí primero origen y destino (mapa o búsqueda).');
      return;
    }
    setPublishMapMode(mode);
    setMapModalVisible(true);
  };

  const applyOriginFromMap = useCallback((lat: number, lng: number) => {
    const fallback = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    setOrigin({ lat, lng, label: fallback });
    setOriginInput(fallback);
    void reverseGeocodeStructured(lat, lng).then((r) => {
      setOrigin((prev) =>
        prev && Math.abs(prev.lat - lat) < 1e-6 && Math.abs(prev.lng - lng) < 1e-6
          ? { ...prev, label: r.displayName }
          : prev
      );
      setOriginInput((inp) => (inp === fallback ? r.displayName : inp));
    });
  }, []);

  const applyDestinationFromMap = useCallback((lat: number, lng: number) => {
    const fallback = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    setDestination({ lat, lng, label: fallback });
    setDestinationInput(fallback);
    void reverseGeocodeStructured(lat, lng).then((r) => {
      setDestination((prev) =>
        prev && Math.abs(prev.lat - lat) < 1e-6 && Math.abs(prev.lng - lng) < 1e-6
          ? { ...prev, label: r.displayName }
          : prev
      );
      setDestinationInput((inp) => (inp === fallback ? r.displayName : inp));
    });
  }, []);

  const onPublishMapPress = (e: MapPressEvent) => {
    const raw: GeoPoint = {
      lat: e.nativeEvent.coordinate.latitude,
      lng: e.nativeEvent.coordinate.longitude,
    };
    if (publishMapMode === 'origin') {
      applyOriginFromMap(raw.lat, raw.lng);
      return;
    }
    if (publishMapMode === 'destination') {
      applyDestinationFromMap(raw.lat, raw.lng);
      return;
    }
    if (publishMapMode === 'waypoint' && origin && destination) {
      if (isGroupedPublishFlow) return;
      if (waypoints.length >= MAX_DRIVER_PUBLISH_WAYPOINTS) return;
      const chord: GeoPoint[] = [
        { lat: origin.lat, lng: origin.lng },
        { lat: destination.lat, lng: destination.lng },
      ];
      const guide =
        routePolyline.length >= 2
          ? routePolyline.map((p) => ({ lat: p.lat, lng: p.lng }))
          : chord;
      // Proyección solo para validar orden (entre origen y destino); el pin queda donde tocó el conductor.
      const refOnGuide = snapToPolyline(raw, guide);
      const pu = getPositionAlongPolyline({ lat: origin.lat, lng: origin.lng }, guide);
      const du = getPositionAlongPolyline({ lat: destination.lat, lng: destination.lng }, guide);
      const sp = getPositionAlongPolyline(refOnGuide, guide);
      if (sp <= pu + 1e-5 || sp >= du - 1e-5) return;
      const lat = raw.lat;
      const lng = raw.lng;
      const fallback = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      const added: Point = { lat, lng, label: fallback };
      setWaypoints((prev) =>
        [...prev, added]
          .sort((a, b) => getPositionAlongPolyline(a, chord) - getPositionAlongPolyline(b, chord))
          .slice(0, MAX_DRIVER_PUBLISH_WAYPOINTS)
      );
      void reverseGeocodeStructured(lat, lng).then((r) => {
        setWaypoints((wps) =>
          wps.map((w) =>
            Math.abs(w.lat - lat) < 1e-6 && Math.abs(w.lng - lng) < 1e-6 && w.label === fallback
              ? { ...w, label: r.displayName }
              : w
          )
        );
      });
    }
  };

  const removeWaypointAt = useCallback((index: number) => {
    setWaypoints((prev) => prev.filter((_, j) => j !== index));
  }, []);

  const seats = userProfile?.vehicle_seat_count ?? 6;
  const capSeats = Math.max(1, seats);
  /** Viajes disponibles: cupos = capacidad del vehículo (perfil). Ofertas: el conductor elige cupos ≤ capacidad. */
  const offerSeats = isGroupedPublishFlow
    ? capSeats
    : !isLongDistance
      ? capSeats
      : Math.min(Math.max(1, publishSeatCount), capSeats);
  const availableSeatsForPublish = Math.max(0, offerSeats - linkedPassengerSeats);

  const handlePublish = async () => {
    if (!session?.id || !userProfile) return;
    if (driverSuspended) {
      Alert.alert(
        'No podés publicar',
        'Tu cuenta tiene restricción por deuda o por incumplimiento de viaje programado. Contactá a soporte.'
      );
      return;
    }
    if (isDriverApp) {
      const requiredTypes = ['passenger_insurance', 'dinatran_permit', 'cedula_verde'] as const;
      const { data: docs, error: docsErr } = await supabase
        .from('driver_documents')
        .select('doc_type, status, expires_at')
        .eq('driver_id', session.id);
      if (docsErr) {
        Alert.alert('Documentos', 'No pudimos validar tus documentos. Intentá de nuevo en unos segundos.');
        return;
      }
      const todayYmd = new Date().toISOString().slice(0, 10);
      for (const t of requiredTypes) {
        const row = (docs ?? []).find((d) => String((d as { doc_type?: unknown }).doc_type) === t) as
          | { status?: string | null; expires_at?: string | null }
          | undefined;
        if (!row || row.status !== 'approved') {
          Alert.alert(
            'Documentación pendiente',
            'Para publicar viajes necesitás tener aprobados: seguro pasajero, habilitación DINATRAN y cédula verde.'
          );
          return;
        }
        const exp = String(row.expires_at ?? '').trim();
        if (exp && exp < todayYmd) {
          Alert.alert(
            'Documento vencido',
            'Tenés documentación vencida. Subí el documento actualizado para volver a publicar.'
          );
          return;
        }
      }
    }
    if (!origin || !destination) {
      Alert.alert('Ruta', 'Elegí origen y destino (escribí y tocá una sugerencia).');
      return;
    }
    if (!departureTime) {
      Alert.alert('Fecha', 'Completá la hora de salida.');
      return;
    }
    const maskDaily = Boolean(isDriverApp && !isGroupedPublishFlow && templateScheduleDaily);
    if (maskDaily && coerceScheduleWeekdayMask(templateWeekdayMask) === 0) {
      Alert.alert('Días', 'Marcá al menos un día de la semana para el recorrido diario.');
      return;
    }
    let publishDateYmd = departureDate.trim();
    if (!publishDateYmd) {
      if (maskDaily) {
        const iso = computeNextTriggerIso(
          new Date(),
          toLocalYyyyMmDd(new Date()),
          formatTimeHhMm(departureTime),
          true,
          coerceScheduleWeekdayMask(templateWeekdayMask)
        );
        if (!iso) {
          Alert.alert('Fecha', 'No hay próxima fecha válida con los días y hora elegidos.');
          return;
        }
        publishDateYmd = toLocalYyyyMmDd(new Date(iso));
      } else {
        Alert.alert('Fecha', 'Completá fecha y hora de salida.');
        return;
      }
    }
    const departureDateTime = new Date(`${publishDateYmd}T${formatTimeHhMm(departureTime)}`);
    if (Number.isNaN(departureDateTime.getTime())) {
      Alert.alert('Fecha', 'Fecha u hora inválida.');
      return;
    }
    if (departureDateTime <= new Date()) {
      Alert.alert('Fecha', 'La salida debe ser en el futuro.');
      return;
    }
    if (isDriverApp && !isGroupedPublishFlow && !routeName.trim()) {
      Alert.alert('Nombre del viaje', 'Es obligatorio poner un nombre al viaje (se muestra en Inicio y a los pasajeros).');
      return;
    }
    const totalGsParsed =
      !isGroupedPublishFlow && isLongDistance
        ? Math.max(0, parseInt(totalCollectGsInput.replace(/\D/g, ''), 10) || 0)
        : 0;
    const derivedSeatFromTotal =
      isLongDistance && totalGsParsed > 0 && offerSeats > 0
        ? Math.max(1000, Math.ceil(totalGsParsed / offerSeats))
        : 0;
    const manualSeatPrice =
      isLongDistance
        ? derivedSeatFromTotal > 0
          ? derivedSeatFromTotal
          : Math.max(0, parseInt(manualSeatPriceInput.replace(/\D/g, ''), 10) || 0)
        : 0;
    if (isLongDistance && manualSeatPrice < 1000) {
      Alert.alert(
        'Precio por asiento',
        'Definí precio por asiento o meta total a cobrar (Gs) para calcular el precio por cupo.'
      );
      return;
    }

    setSubmitting(true);
    setFormError(null);
    let recurringExtraPublished = 0;
    try {
      const dur = Math.max(15, Math.min(1440, durationMin));
      const newStart = departureDateTime.getTime();
      const newEnd = newStart + dur * 60 * 1000;
      const { data: existingRides } = await supabase
        .from('rides')
        .select('id, departure_time, estimated_duration_minutes')
        .eq('driver_id', session.id)
        .in('status', ['published', 'booked', 'en_route', 'draft']);
      for (const r of existingRides ?? []) {
        if (existingGroupRideId && String((r as { id?: string }).id) === existingGroupRideId) continue;
        const start = new Date(r.departure_time as string).getTime();
        const d = (r.estimated_duration_minutes ?? 60) * 60 * 1000;
        const end = start + d;
        if (newStart < end && newEnd > start) {
          Alert.alert('Horario', 'Ya tenés un viaje que se solapa con este horario.');
          setSubmitting(false);
          return;
        }
      }

      const baseRoute = routePolyline.length >= 2 ? routePolyline : null;

      const collectMeta =
        !isGroupedPublishFlow && isLongDistance && totalGsParsed > 0
          ? `Meta recaudación total (conductor): ${totalGsParsed.toLocaleString('es-PY')} Gs.`
          : '';
      const fullDescription = collectMeta.trim() || null;

      const driverTemplatePersistenceId =
        isDriverApp && !isGroupedPublishFlow
          ? driverTemplateIdParam ?? (createDriverTemplateParam ? newDriverTemplateId() : undefined)
          : undefined;

      const ridePayload: Record<string, unknown> = {
        driver_id: session.id,
        origin_lat: origin.lat,
        origin_lng: origin.lng,
        origin_label: origin.label ?? null,
        destination_lat: destination.lat,
        destination_lng: destination.lng,
        destination_label: destination.label ?? null,
        departure_time: departureDateTime.toISOString(),
        estimated_duration_minutes: dur,
        price_per_seat: manualSeatPrice,
        total_seats: offerSeats,
        available_seats: availableSeatsForPublish,
        capacity: offerSeats,
        route_name: routeName.trim().slice(0, 100) || null,
        description: fullDescription,
        vehicle_info: {
          model: userProfile.vehicle_model,
          year:
            typeof userProfile.vehicle_year === 'number'
              ? userProfile.vehicle_year
              : parseInt(String(userProfile.vehicle_year), 10) || null,
        },
        seat_layout: userProfile.vehicle_seat_layout ?? { rows: [userProfile.vehicle_seat_count] },
        flexible_departure: isLongDistance && departureFlexibility === 'flexible_30',
        departure_flexibility: isLongDistance ? departureFlexibility : 'strict_5',
        status: 'published',
        mode: 'free',
        ...(isDriverApp && !isGroupedPublishFlow && driverTemplatePersistenceId
          ? {
              driver_home_template_slot: driverTemplatePersistenceId,
              driver_home_schedule_daily: templateScheduleDaily,
            }
          : {
              driver_home_template_slot: null,
              driver_home_schedule_daily: null,
            }),
      };

      let rideId: string;
      if (isGroupedPublishFlow && existingGroupRideId) {
        const { data: upd, error: updErr } = await supabase
          .from('rides')
          .update(ridePayload)
          .eq('id', existingGroupRideId)
          .eq('status', 'awaiting_driver')
          .select('id')
          .maybeSingle();
        if (updErr) throw updErr;
        if (!upd?.id) {
          Alert.alert(
            'No disponible',
            'Este viaje de sistema ya fue tomado por otro conductor o cambió de estado. Volvé atrás y actualizá la lista.'
          );
          setSubmitting(false);
          return;
        }
        rideId = String(upd.id);
        const { error: delStopsErr } = await supabase.from('ride_stops').delete().eq('ride_id', rideId);
        if (delStopsErr) throw delStopsErr;
      } else {
        let { data, error } = await supabase.from('rides').insert(ridePayload).select().single();

        if (error) {
          const msg = String((error as { message?: string }).message ?? '');
          if (msg.includes('driver_ride_overlap') || msg.includes('solapen')) {
            Alert.alert('Horario', 'Ya tenés un viaje en ese horario.');
            setSubmitting(false);
            return;
          }
          const { departure_flexibility: _x, ...payloadSinFlex } = ridePayload;
          const res2 = await supabase.from('rides').insert(payloadSinFlex).select().single();
          data = res2.data;
          error = res2.error;
        }

        if (error) throw error;
        if (!data?.id) throw new Error('No se obtuvo el id del viaje');
        rideId = data.id as string;
      }

      if (tripRequestIdsToLink.length > 0) {
        const { error: tripErr } = await supabase
          .from('trip_requests')
          .update({ ride_id: rideId, status: 'accepted', updated_at: new Date().toISOString() })
          .in('id', tripRequestIdsToLink);
        if (tripErr) {
          console.warn('trip_requests link:', tripErr);
          Alert.alert(
            'Aviso',
            'El viaje se publicó pero no se pudieron vincular todas las solicitudes. Revisá desde la web o soporte.'
          );
        }
      }

      const linkDemandGroupId = groupIdParam ?? prefillResolvedGroupId;
      if (linkDemandGroupId && !existingGroupRideId) {
        const { error: groupLinkErr } = await supabase
          .from('demand_route_groups')
          .update({ ride_id: rideId })
          .eq('id', linkDemandGroupId);
        if (groupLinkErr) {
          console.warn('demand_route_groups link:', groupLinkErr);
        }
      }

      if (baseRoute) {
        const { error: upErr } = await supabase
          .from('rides')
          .update({ base_route_polyline: baseRoute, max_deviation_km: 1.0 })
          .eq('id', rideId);
        if (upErr) console.warn('base_route_polyline:', upErr);
      }

      const chord: GeoPoint[] = [
        { lat: origin.lat, lng: origin.lng },
        { lat: destination.lat, lng: destination.lng },
      ];
      const orderedWps = [...waypoints].sort(
        (a, b) => getPositionAlongPolyline(a, chord) - getPositionAlongPolyline(b, chord)
      );
      const stopsBase = [
        { ride_id: rideId, stop_order: 0, lat: origin.lat, lng: origin.lng, label: origin.label ?? null },
        ...orderedWps.map((w, i) => ({
          ride_id: rideId,
          stop_order: i + 1,
          lat: w.lat,
          lng: w.lng,
          label: (w.label ?? null) as string | null,
        })),
        {
          ride_id: rideId,
          stop_order: orderedWps.length + 1,
          lat: destination.lat,
          lng: destination.lng,
          label: destination.label ?? null,
        },
      ];
      const stopsWithBase = stopsBase.map((s, i) => ({
        ...s,
        is_base_stop: i === 0 || i === stopsBase.length - 1,
      }));
      let stopsError = null as { message?: string } | null;
      const { error: err1 } = await supabase.from('ride_stops').insert(stopsWithBase);
      if (err1 && String(err1.message).includes('is_base_stop')) {
        const { error: err2 } = await supabase.from('ride_stops').insert(stopsBase);
        stopsError = err2;
      } else {
        stopsError = err1;
      }
      if (stopsError) throw stopsError;

      if (
        templateScheduleDaily &&
        isDriverApp &&
        !isGroupedPublishFlow &&
        !isLongDistance &&
        driverTemplatePersistenceId
      ) {
        const mask = coerceScheduleWeekdayMask(templateWeekdayMask);
        const hm = formatTimeHhMm(departureTime);
        const occupied: { start: number; end: number }[] = [];
        for (const r of existingRides ?? []) {
          if (existingGroupRideId && String((r as { id?: string }).id) === existingGroupRideId) continue;
          const start = new Date(r.departure_time as string).getTime();
          const span = (r.estimated_duration_minutes ?? 60) * 60 * 1000;
          occupied.push({ start, end: start + span });
        }
        occupied.push({ start: newStart, end: newEnd });

        const mkStopsForRide = (rid: string) => {
          const base = [
            { ride_id: rid, stop_order: 0, lat: origin.lat, lng: origin.lng, label: origin.label ?? null },
            ...orderedWps.map((w, i) => ({
              ride_id: rid,
              stop_order: i + 1,
              lat: w.lat,
              lng: w.lng,
              label: (w.label ?? null) as string | null,
            })),
            {
              ride_id: rid,
              stop_order: orderedWps.length + 1,
              lat: destination.lat,
              lng: destination.lng,
              label: destination.label ?? null,
            },
          ];
          return base;
        };

        let walkYmd = addDaysToYmd(publishDateYmd, 1);
        for (let guard = 0; guard < 55 && recurringExtraPublished < DRIVER_RECURRING_MAX_EXTRA; guard++) {
          const parts = walkYmd.split('-').map((x) => parseInt(x, 10));
          if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) break;
          const dow = new Date(parts[0]!, parts[1]! - 1, parts[2]!, 12, 0, 0, 0).getDay();
          if ((mask & (1 << dow)) === 0) {
            walkYmd = addDaysToYmd(walkYmd, 1);
            continue;
          }
          const dep = new Date(`${walkYmd}T${hm}`);
          if (Number.isNaN(dep.getTime()) || dep.getTime() <= Date.now()) {
            walkYmd = addDaysToYmd(walkYmd, 1);
            continue;
          }
          const sMs = dep.getTime();
          const eMs = sMs + dur * 60 * 1000;
          if (occupied.some(({ start, end }) => sMs < end && eMs > start)) {
            walkYmd = addDaysToYmd(walkYmd, 1);
            continue;
          }

          const extraPayload: Record<string, unknown> = {
            ...ridePayload,
            departure_time: dep.toISOString(),
            driver_home_template_slot: driverTemplatePersistenceId,
            driver_home_schedule_daily: templateScheduleDaily,
          };

          let ins = await supabase.from('rides').insert(extraPayload).select().single();
          if (ins.error) {
            const msg = String((ins.error as { message?: string }).message ?? '');
            if (msg.includes('driver_ride_overlap') || msg.includes('solapen')) {
              walkYmd = addDaysToYmd(walkYmd, 1);
              continue;
            }
            const { departure_flexibility: _xf, ...payloadSinFlex } = extraPayload;
            ins = await supabase.from('rides').insert(payloadSinFlex).select().single();
          }
          if (ins.error || !ins.data?.id) break;
          const extraRideId = String((ins.data as { id: string }).id);
          occupied.push({ start: sMs, end: eMs });

          if (baseRoute) {
            const { error: upPoly } = await supabase
              .from('rides')
              .update({ base_route_polyline: baseRoute, max_deviation_km: 1.0 })
              .eq('id', extraRideId);
            if (upPoly) console.warn('base_route_polyline recurring:', upPoly);
          }
          const sb = mkStopsForRide(extraRideId);
          const sbWith = sb.map((s, i) => ({ ...s, is_base_stop: i === 0 || i === sb.length - 1 }));
          const { error: es1 } = await supabase.from('ride_stops').insert(sbWith);
          if (es1 && String(es1.message).includes('is_base_stop')) {
            const { error: es2 } = await supabase.from('ride_stops').insert(sb);
            if (es2) console.warn('ride_stops recurring:', es2);
          } else if (es1) {
            console.warn('ride_stops recurring:', es1);
          }
          recurringExtraPublished++;
          walkYmd = addDaysToYmd(walkYmd, 1);
        }
      }

      if (!isGroupedPublishFlow && driverTemplatePersistenceId && isDriverApp) {
        const weekdayMaskForTemplate = templateScheduleDaily
          ? coerceScheduleWeekdayMask(templateWeekdayMask)
          : 1 << (departureDateTime.getDay() & 7);
        await upsertDriverHomeTemplateRow(session.id, driverTemplatePersistenceId, {
          tripDisplayName: routeName.trim().slice(0, 100),
          publishSeatCount: offerSeats,
          totalCollectGs: totalGsParsed,
          departureTimeHm: departureTime,
          departureDateYmd: publishDateYmd,
          scheduleDaily: templateScheduleDaily,
          scheduleWeekdayMask: coerceScheduleWeekdayMask(weekdayMaskForTemplate),
          enabled: true,
          rideKind: publishKind,
          origin: originInput.trim(),
          destination: destinationInput.trim(),
          originLat: origin.lat,
          originLng: origin.lng,
          destinationLat: destination.lat,
          destinationLng: destination.lng,
          waypoints: [...waypoints]
            .sort((a, b) => getPositionAlongPolyline(a, chord) - getPositionAlongPolyline(b, chord))
            .map((w) => ({ lat: w.lat, lng: w.lng, label: w.label ?? null })),
          homeActiveRideId: rideId,
        });
      }

      const { data: shareRow } = await supabase
        .from('rides')
        .select('share_code')
        .eq('id', rideId)
        .maybeSingle();
      const rideShareCode = String((shareRow as { share_code?: unknown } | null)?.share_code ?? '').trim();
      const recurringLine =
        !isGroupedPublishFlow && recurringExtraPublished > 0
          ? `\n\nSe publicaron ${recurringExtraPublished} fecha(s) más con el mismo tramo (días de la plantilla). Los pasajeros pueden unirse con anticipación.`
          : '';

      navigation.replace('RideDetail', {
        rideId,
        publishSharePrompt: rideShareCode
          ? { code: rideShareCode, extraMessage: recurringLine || undefined }
          : undefined,
      });
    } catch (e) {
      Alert.alert('Error', formatSupabaseError(e));
    } finally {
      setSubmitting(false);
    }
  };

  handlePublishRef.current = () => handlePublish();

  useEffect(() => {
    if (!autoPublishParam) return;
    if (autoPublishOnceRef.current) return;
    if (gateLoading || !userProfile || prefillLoading) return;
    if (!isDriverApp || isGroupedPublishFlow) return;
    if (!driverTemplateIdParam) return;
    if (!origin || !destination) return;
    if (!departureTime.trim()) return;
    if (!routeName.trim()) return;
    autoPublishOnceRef.current = true;
    const t = setTimeout(() => {
      void handlePublishRef.current?.();
    }, 650);
    return () => clearTimeout(t);
  }, [
    autoPublishParam,
    gateLoading,
    userProfile,
    prefillLoading,
    isDriverApp,
    isGroupedPublishFlow,
    driverTemplateIdParam,
    origin,
    destination,
    departureTime,
    routeName,
  ]);

  if (gateLoading || !userProfile) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={GREEN} />
      </View>
    );
  }

  const hasApi = Boolean(env.apiBaseUrl?.trim());

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {prefillLoading && (
        <View style={styles.prefillRow}>
          <ActivityIndicator size="small" color={GREEN} style={{ marginRight: 8 }} />
          <Text style={styles.prefillText}>Cargando datos de la solicitud…</Text>
        </View>
      )}

      {!hasApi && (
        <Text style={styles.warnBanner}>
          Configurá EXPO_PUBLIC_API_BASE_URL para ver sugerencias de dirección y la ruta en el mapa.
        </Text>
      )}
      {!contextualPublish && (
        <>
          <Text style={styles.label}>Tipo de viaje</Text>
          <View style={styles.kindPickerRow}>
            <TouchableOpacity
              style={[styles.kindChip, publishKind === 'internal' && styles.kindChipActive]}
              onPress={() => {
                setPublishKindFree('internal');
                setManualSeatPriceInput('');
                setTotalCollectGsInput('');
              }}
              accessibilityRole="button"
              accessibilityLabel="Viajes disponibles"
            >
              <Text style={[styles.kindChipText, publishKind === 'internal' && styles.kindChipTextActive]}>
                Viajes disponibles
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.kindChip, publishKind === 'long_distance' && styles.kindChipActive]}
              onPress={() => setPublishKindFree('long_distance')}
              accessibilityRole="button"
              accessibilityLabel="Ofertas de viajes"
            >
              <Text style={[styles.kindChipText, publishKind === 'long_distance' && styles.kindChipTextActive]}>
                Ofertas de viajes
              </Text>
            </TouchableOpacity>
          </View>
        </>
      )}
      {!isGroupedPublishFlow ? (
        <View style={[styles.kindBanner, isLongDistance ? styles.kindBannerLong : styles.kindBannerInternal]}>
          <Text style={styles.kindBannerTitle}>
            {isLongDistance ? 'Publicando: oferta de viaje' : 'Publicando: viaje disponible'}
          </Text>
          <Text style={styles.kindBannerText}>
            {isLongDistance
              ? 'Solo en esta modalidad el conductor define el precio por asiento.'
              : 'El precio final lo define el tramo elegido por el pasajero al reservar.'}
          </Text>
        </View>
      ) : (
        <View style={[styles.kindBanner, styles.kindBannerInternal]}>
          <Text style={styles.kindBannerTitle}>Publicando: ruta con demanda</Text>
          <Text style={styles.kindBannerText}>
            Los pasajeros y el orden de subidas/bajadas ya están definidos por el grupo. Acá solo marcás tu origen y
            destino operativos para calcular tiempos y publicar el viaje.
          </Text>
        </View>
      )}

      {!isGroupedPublishFlow && distanceKm != null ? (
        <Text style={styles.metaLine}>
          ~{distanceKm.toFixed(1)} km · ~{Math.round(durationMin)} min
        </Text>
      ) : null}

      {!isGroupedPublishFlow ? (
        <Text style={styles.mapHelp}>Presiona el mapa para marcar tu ruta</Text>
      ) : null}
      {waypoints.length > 0 && !isGroupedPublishFlow ? (
        <TouchableOpacity onPress={() => setWaypoints([])}>
          <Text style={styles.clearWp}>Quitar ajustes de ruta</Text>
        </TouchableOpacity>
      ) : null}

      <Pressable
        style={styles.mapWrap}
        onPress={() => openMapPicker(publishMapMode)}
        accessibilityRole="button"
        accessibilityLabel="Abrir mapa en pantalla completa"
      >
        <MapView
          provider={androidMapProvider}
          style={styles.mapPreview}
          region={mapRegion}
          pointerEvents="none"
          scrollEnabled={false}
          zoomEnabled={false}
          loadingEnabled={Platform.OS !== 'android'}
          onMapReady={() => {
            if (__DEV__ && publishPerfT0.current) {
              console.log(
                '[perf][PublishRide] map mounted (onMapReady), ms from screen mount',
                Date.now() - publishPerfT0.current
              );
            }
          }}
        >
          {polylineCoords.length >= 2 && (
            <Polyline coordinates={polylineCoords} strokeColor={GREEN} strokeWidth={4} />
          )}
          {waypoints.map((w, i) => (
            <Marker
              key={`wp-${w.lat}-${w.lng}-${i}`}
              coordinate={{ latitude: w.lat, longitude: w.lng }}
              title={`Ajuste ${i + 1}`}
              pinColor="#2563eb"
            />
          ))}
          {passengerFixedPoints.map((p, i) => (
            <Marker
              key={`pax-fixed-${p.lat}-${p.lng}-${i}`}
              coordinate={{ latitude: p.lat, longitude: p.lng }}
              title={p.label}
              pinColor="#6b7280"
            />
          ))}
          {origin && (
            <Marker coordinate={{ latitude: origin.lat, longitude: origin.lng }} title="Origen" pinColor="red" />
          )}
          {destination && (
            <Marker
              coordinate={{ latitude: destination.lat, longitude: destination.lng }}
              title="Destino"
              pinColor="green"
            />
          )}
        </MapView>
        <View style={styles.mapPreviewOverlay} pointerEvents="none">
          <Text style={styles.mapPreviewOverlayText}>Tocá para pantalla completa</Text>
        </View>
      </Pressable>

      <PublishRouteMapModal
        visible={mapModalVisible}
        onClose={() => setMapModalVisible(false)}
        mapMode={publishMapMode}
        onMapModeChange={setPublishMapMode}
        region={mapRegion}
        polylineCoords={polylineCoords}
        origin={origin}
        destination={destination}
        waypoints={waypoints}
        onMapPress={onPublishMapPress}
        originDestinationReady={Boolean(origin && destination)}
        waypointCount={waypoints.length}
        maxWaypoints={isGroupedPublishFlow ? 0 : MAX_DRIVER_PUBLISH_WAYPOINTS}
        onRemoveWaypoint={removeWaypointAt}
        passengerFixedPoints={passengerFixedPoints}
        showWaypointMode={!isGroupedPublishFlow}
      />

      <Text style={styles.label}>Origen</Text>
      <TextInput
        style={styles.input}
        value={originInput}
        onChangeText={(t) => {
          setOriginInput(t);
          setShowOriginSuggestions(true);
        }}
        onFocus={() => setShowOriginSuggestions(true)}
        placeholder="Buscá una dirección (mín. 3 letras)"
        placeholderTextColor="#9ca3af"
      />
      {showOriginSuggestions && originSuggestions.length > 0 && (
        <View style={styles.suggestions}>
          {originSuggestions.map((s, i) => (
            <TouchableOpacity key={i} style={styles.suggestionRow} onPress={() => selectSuggestion(s, 'origin')}>
              <Text numberOfLines={2}>{s.display_name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {waypoints.length > 0 && !isGroupedPublishFlow ? (
        <View style={styles.wpFormSection}>
          <Text style={styles.label}>Ajustes de ruta</Text>
          {waypoints.map((w, i) => (
            <View key={`wp-form-${w.lat}-${w.lng}-${i}`} style={styles.wpFormBlock}>
              <Text style={styles.wpFormSubLabel}>Ajuste {i + 1}</Text>
              <TextInput
                style={[styles.input, styles.wpFormInputReadonly]}
                value={w.label ?? `${w.lat.toFixed(5)}, ${w.lng.toFixed(5)}`}
                editable={false}
                multiline
                placeholderTextColor="#9ca3af"
              />
            </View>
          ))}
        </View>
      ) : null}

      <Text style={styles.label}>Destino</Text>
      <TextInput
        style={styles.input}
        value={destinationInput}
        onChangeText={(t) => {
          setDestinationInput(t);
          setShowDestinationSuggestions(true);
        }}
        onFocus={() => setShowDestinationSuggestions(true)}
        placeholder="Buscá una dirección (mín. 3 letras)"
        placeholderTextColor="#9ca3af"
      />
      {showDestinationSuggestions && destinationSuggestions.length > 0 && (
        <View style={styles.suggestions}>
          {destinationSuggestions.map((s, i) => (
            <TouchableOpacity
              key={i}
              style={styles.suggestionRow}
              onPress={() => selectSuggestion(s, 'destination')}
            >
              <Text numberOfLines={2}>{s.display_name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {isDriverApp && !isGroupedPublishFlow ? (
        <>
          <Text style={styles.label}>¿Desea reprogramar diario este viaje?</Text>
          <View style={styles.driverDailySwitchWrap}>
            <Switch
              value={templateScheduleDaily}
              onValueChange={(v) => {
                setTemplateScheduleDaily(v);
                if (v) {
                  setTemplateWeekdayMask((m) => {
                    const c = coerceScheduleWeekdayMask(m);
                    return c === 0 ? SCHEDULE_WEEKDAY_MASK_ALL : c;
                  });
                }
              }}
              trackColor={{ false: '#d1d5db', true: '#86efac' }}
              thumbColor={templateScheduleDaily ? appBrand.colors.primary : '#f3f4f6'}
            />
          </View>
          {templateScheduleDaily ? (
            <View style={styles.weekdayBlock}>
              <Text style={styles.weekdayBlockTitle}>Días que hacés este recorrido</Text>
              <View style={styles.weekdayChipsRow}>
                {WEEKDAY_TOGGLE_LABELS.map((label, i) => {
                  const on = ((templateWeekdayMask >> i) & 1) === 1;
                  return (
                    <TouchableOpacity
                      key={label}
                      style={[styles.weekdayChip, on && styles.weekdayChipOn]}
                      onPress={() => {
                        setTemplateWeekdayMask((m) => {
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
              {!isLongDistance ? (
                <Text style={styles.weekdayBatchHint}>
                  Al publicar (viaje interno), se generan varias publicaciones en fechas futuras según estos días, para
                  que los pasajeros puedan unirse con anticipación.
                </Text>
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}

      <Text style={styles.label}>Fecha del viaje</Text>
      {isGroupedPublishFlow ? (
        <View style={[styles.input, styles.inputReadonly]}>
          <Text style={departureDate ? styles.dateFieldText : styles.dateFieldPlaceholder}>
            {departureDate || '—'}
          </Text>
        </View>
      ) : isDriverApp && !isGroupedPublishFlow && templateScheduleDaily ? (
        <View style={[styles.input, styles.inputReadonly]}>
          <Text style={departureDate ? styles.dateFieldText : styles.dateFieldPlaceholder}>
            {departureDate
              ? `Próxima salida: ${departureDate} · ${formatTimeHhMm(departureTime)}`
              : 'Calculando próxima fecha según los días marcados…'}
          </Text>
        </View>
      ) : (
        <TouchableOpacity
          style={styles.input}
          onPress={() => setShowDatePicker(true)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Elegir fecha de salida"
        >
          <Text style={departureDate ? styles.dateFieldText : styles.dateFieldPlaceholder}>
            {departureDate || 'Tocá para elegir fecha'}
          </Text>
        </TouchableOpacity>
      )}
      {showDatePicker && !isGroupedPublishFlow && !(isDriverApp && templateScheduleDaily) ? (
        <>
          <DateTimePicker
            value={
              departureDate
                ? new Date(`${departureDate}T12:00:00`)
                : (() => {
                    const t = new Date();
                    t.setHours(12, 0, 0, 0);
                    return t;
                  })()
            }
            mode="date"
            display={datePickerDisplay()}
            minimumDate={(() => {
              const t = new Date();
              t.setHours(0, 0, 0, 0);
              return t;
            })()}
            onChange={(event, date) => {
              if (Platform.OS === 'android') setShowDatePicker(false);
              if (event.type === 'dismissed') setShowDatePicker(false);
              if (event.type === 'set' && date) {
                const min = (() => {
                  const t = new Date();
                  t.setHours(0, 0, 0, 0);
                  return t;
                })();
                const picked = date < min ? min : date;
                setDepartureDate(toLocalYyyyMmDd(picked));
              }
            }}
          />
          {Platform.OS === 'ios' ? (
            <TouchableOpacity style={styles.pickerDoneRow} onPress={() => setShowDatePicker(false)}>
              <Text style={styles.pickerDoneText}>Listo</Text>
            </TouchableOpacity>
          ) : null}
        </>
      ) : null}

      <Text style={styles.label}>Hora que debes llegar al punto de origen marcado</Text>
      {isGroupedPublishFlow ? (
        <View style={[styles.input, styles.inputReadonly]}>
          <Text style={styles.dateFieldText}>{departureTime || '—'}</Text>
        </View>
      ) : (
        <TouchableOpacity
          style={styles.input}
          onPress={() => setShowTimePicker(true)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Elegir hora de salida"
        >
          <Text style={styles.dateFieldText}>{departureTime}</Text>
        </TouchableOpacity>
      )}
      {showTimePicker && !isGroupedPublishFlow ? (
        <>
          <DateTimePicker
            value={(() => {
              const [h, m] = departureTime.split(':').map(Number);
              const d = new Date();
              d.setHours(Number.isFinite(h) ? h : 8, Number.isFinite(m) ? m : 0, 0, 0);
              return d;
            })()}
            mode="time"
            display={timePickerDisplay()}
            is24Hour
            onChange={(event, date) => {
              if (Platform.OS === 'android') setShowTimePicker(false);
              if (event.type === 'dismissed') setShowTimePicker(false);
              if (event.type === 'set' && date) {
                setDepartureTime(
                  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
                );
              }
            }}
          />
          {Platform.OS === 'ios' ? (
            <TouchableOpacity style={styles.pickerDoneRow} onPress={() => setShowTimePicker(false)}>
              <Text style={styles.pickerDoneText}>Listo</Text>
            </TouchableOpacity>
          ) : null}
        </>
      ) : null}

      {isDriverApp && !isGroupedPublishFlow && isLongDistance ? (
        <>
          <Text style={styles.label}>Meta total a cobrar (Gs, referencia)</Text>
          <TextInput
            style={styles.input}
            value={totalCollectGsInput}
            onChangeText={(t) => setTotalCollectGsInput(t.replace(/[^\d]/g, ''))}
            keyboardType="number-pad"
            placeholder="Ej. 200000 (opcional)"
            placeholderTextColor="#9ca3af"
          />
          <Text style={styles.priceNote}>
            Referencia tuya. Si completás meta y cupos, el precio por cupo se calcula al publicar.
          </Text>
        </>
      ) : null}

      {isLongDistance ? (
        <>
          <Text style={styles.label}>Flexibilidad de salida</Text>
          <View style={styles.segmentRow}>
            <TouchableOpacity
              style={[
                styles.segmentBtn,
                styles.segmentBtnLeft,
                departureFlexibility === 'strict_5' && styles.segmentBtnActive,
              ]}
              onPress={() => setDepartureFlexibility('strict_5')}
            >
              <Text style={[styles.segmentText, departureFlexibility === 'strict_5' && styles.segmentTextActive]}>
                Estricta (5 min)
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.segmentBtn,
                styles.segmentBtnRight,
                departureFlexibility === 'flexible_30' && styles.segmentBtnActive,
              ]}
              onPress={() => setDepartureFlexibility('flexible_30')}
            >
              <Text style={[styles.segmentText, departureFlexibility === 'flexible_30' && styles.segmentTextActive]}>
                Flexible (30 min)
              </Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}

      {!isGroupedPublishFlow && isLongDistance ? (
        <>
          <Text style={styles.label}>Cupos a publicar (pasajeros)</Text>
          <TextInput
            style={styles.input}
            value={String(publishSeatCount)}
            onChangeText={(t) => {
              const digits = t.replace(/\D/g, '');
              if (!digits) {
                setPublishSeatCount(1);
                return;
              }
              const n = parseInt(digits, 10);
              setPublishSeatCount(Math.min(Math.max(1, n), capSeats));
            }}
            keyboardType="number-pad"
            placeholder={`1–${capSeats}`}
            placeholderTextColor="#9ca3af"
          />
        </>
      ) : null}
      {isGroupedPublishFlow || isLongDistance ? (
        <>
          <Text style={styles.label}>Asientos</Text>
          <Text style={styles.seatsReadonly}>
            {isGroupedPublishFlow
              ? `${availableSeatsForPublish}/${seats} asientos`
              : `Vehículo: ${seats} asientos · este viaje: ${offerSeats} cupo(s) publicados · disponibles ${availableSeatsForPublish}.`}
          </Text>
        </>
      ) : null}

      {isLongDistance ? (
        <>
          <Text style={styles.label}>Precio por asiento</Text>
          <TextInput
            style={styles.input}
            value={manualSeatPriceInput}
            onChangeText={(t) => setManualSeatPriceInput(t.replace(/[^\d]/g, ''))}
            keyboardType="number-pad"
            placeholder={totalCollectGsInput.replace(/\D/g, '') ? 'Opcional si usás meta total arriba' : 'Ej. 25000'}
            placeholderTextColor="#9ca3af"
          />
          <Text style={styles.priceNote}>
            {totalCollectGsInput.replace(/\D/g, '')
              ? 'Si completaste meta total y cupos, se usa el precio por cupo calculado (redondeo hacia arriba). Si no, vale el número que ingreses acá.'
              : 'Este valor lo define el conductor y se usa como precio por asiento para la reserva.'}
          </Text>
        </>
      ) : null}

      <Text style={styles.label}>
        {isDriverApp && !isGroupedPublishFlow ? 'Nombre del viaje (obligatorio)' : 'Nombre del viaje (opcional)'}
      </Text>
      <TextInput
        style={styles.input}
        value={routeName}
        onChangeText={(t) => setRouteName(t.slice(0, 100))}
        placeholder="Ej. Centro–Luque mañana, Ruta universidad…"
        placeholderTextColor="#9ca3af"
        maxLength={100}
      />
      <Text style={styles.priceNote}>
        {isDriverApp && !isGroupedPublishFlow
          ? 'Se muestra en tu Inicio (plantilla) y lo ven los pasajeros en el listado.'
          : 'Lo ven los pasajeros al buscar y en el listado de viajes disponibles.'}
      </Text>

      {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

      <TouchableOpacity
        style={[styles.primaryBtn, submitting && styles.primaryBtnDisabled]}
        onPress={handlePublish}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryBtnText}>
            {isGroupedPublishFlow ? 'Publicar viaje para esta ruta' : 'Publicar viaje'}
          </Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.cancelBtn} onPress={() => navigation.goBack()} disabled={submitting}>
        <Text style={styles.cancelBtnText}>Cancelar</Text>
      </TouchableOpacity>

      {Platform.OS === 'ios' ? <View style={{ height: 24 }} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  prefillRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  prefillText: { fontSize: 13, color: '#6b7280' },
  warnBanner: {
    backgroundColor: '#fef3c7',
    color: '#92400e',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
    fontSize: 13,
  },
  metaLine: { fontSize: 14, color: GREEN, fontWeight: '600', marginBottom: 8 },
  kindBanner: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    marginBottom: 10,
  },
  kindBannerInternal: { backgroundColor: appBrand.colors.greenLight, borderColor: '#86efac' },
  kindBannerLong: { backgroundColor: '#ecfeff', borderColor: '#67e8f9' },
  kindBannerTitle: { fontSize: 13, fontWeight: '700', color: appBrand.colors.primary },
  kindBannerText: { fontSize: 12, color: '#4b5563', marginTop: 4, lineHeight: 17 },
  mapWrap: {
    height: 200,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    position: 'relative',
    backgroundColor: '#e8ece9',
  },
  mapPreview: { width: '100%', height: '100%' },
  mapPreviewOverlay: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    backgroundColor: 'rgba(22,101,52,0.88)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  mapPreviewOverlayText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  label: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 6 },
  driverDailySwitchWrap: { marginBottom: 12, alignSelf: 'flex-start' },
  weekdayBlock: {
    borderWidth: 1,
    borderColor: appBrand.colors.greenLight,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    backgroundColor: appBrand.colors.greenLight,
  },
  weekdayBlockTitle: { fontSize: 14, fontWeight: '700', color: appBrand.colors.primary },
  weekdayBatchHint: { fontSize: 12, color: '#4b5563', marginTop: 10, lineHeight: 17 },
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
    borderColor: appBrand.colors.primary,
    backgroundColor: appBrand.colors.primary,
  },
  weekdayChipText: { fontSize: 12, fontWeight: '700', color: '#374151' },
  weekdayChipTextOn: { color: '#fff' },
  wpFormSection: { marginBottom: 2 },
  wpFormBlock: { marginBottom: 0 },
  wpFormSubLabel: { fontSize: 12, fontWeight: '600', color: '#64748b', marginBottom: 4 },
  wpFormInputReadonly: {
    backgroundColor: '#f9fafb',
    color: '#374151',
    marginBottom: 10,
    minHeight: 48,
    textAlignVertical: 'center',
  },
  dateFieldText: { fontSize: 16, color: '#111' },
  dateFieldPlaceholder: { fontSize: 16, color: '#9ca3af' },
  pickerDoneRow: {
    alignSelf: 'flex-end',
    marginBottom: 12,
    marginTop: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  pickerDoneText: { fontSize: 17, fontWeight: '600', color: GREEN },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 16,
    marginBottom: 12,
    color: '#111',
  },
  inputReadonly: {
    backgroundColor: '#f3f4f6',
  },
  suggestions: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    marginTop: -8,
    marginBottom: 12,
    overflow: 'hidden',
  },
  suggestionRow: { padding: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e5e7eb' },
  segmentRow: { flexDirection: 'row', marginBottom: 16 },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
    alignItems: 'center',
  },
  segmentBtnLeft: { marginRight: 4 },
  segmentBtnRight: { marginLeft: 4 },
  segmentBtnActive: { backgroundColor: GREEN, borderColor: GREEN },
  segmentText: { fontSize: 13, color: '#374151', fontWeight: '600' },
  segmentTextActive: { color: '#fff' },
  seatsReadonly: { fontSize: 18, fontWeight: '700', color: '#111', marginBottom: 8 },
  seatsHint: { fontSize: 13, fontWeight: '400', color: '#6b7280' },
  priceNote: { fontSize: 13, color: '#6b7280', marginBottom: 12, lineHeight: 18 },
  errorText: { color: '#b91c1c', marginBottom: 12 },
  primaryBtn: {
    backgroundColor: GREEN,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  primaryBtnDisabled: { opacity: 0.65 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancelBtn: { marginTop: 14, alignItems: 'center', paddingVertical: 8 },
  cancelBtnText: { color: '#6b7280', fontSize: 15 },
  mapHelp: { fontSize: 13, color: '#6b7280', marginBottom: 10, lineHeight: 18 },
  groupFlowHint: { fontSize: 14, color: appBrand.colors.primary, fontWeight: '700', marginBottom: 10 },
  clearWp: { fontSize: 13, color: '#2563eb', fontWeight: '600', marginBottom: 8 },
  kindPickerRow: { flexDirection: 'row', gap: 10, marginBottom: 14, flexWrap: 'wrap' },
  kindChip: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
  },
  kindChipActive: { backgroundColor: GREEN, borderColor: GREEN },
  kindChipText: { fontSize: 14, fontWeight: '600', color: '#374151' },
  kindChipTextActive: { color: '#fff' },
});
