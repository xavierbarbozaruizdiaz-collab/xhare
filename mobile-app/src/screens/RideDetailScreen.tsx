/**
 * Detalle de viaje: pasajero ve conductor y puede reservar; conductor ve resumen tipo publicación e Iniciar/Finalizar viaje.
 */
import { appBrand } from '../ui/theme/brand';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Alert,
  Modal,
  Platform,
  Image,
  Share,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../backend/supabase';
import { updateRideStatus } from '../backend/rideStatus';
import {
  cancelBooking,
  driverLiveMapPoint,
  fetchRideForReserve,
  fetchRidePublicMapPoints,
  type RideStopForReserve,
} from '../rides/api';
import { ensureRideContactConversation } from '../api/messages';
import type { MainStackParamList } from '../navigation/types';
import { rideStatusConfig, formatRideDate, formatRideTime } from '../ui/rideStatusConfig';
import { openNavigation, openNavigationErrorMessage } from '../external-navigation';
import { getNavigationPreference } from '../settings';
import { useRideResolvedPolyline } from '../hooks/useRideResolvedPolyline';
import {
  computeOrderedVisitStopsForMap,
  type OrderedMapVisitRow,
} from '../lib/buildMasterBookRidePolyline';
import { filterOperationalDriverStops } from '../lib/rideStopKinds';
import { RideDetailRouteMap, type PassengerBookingMapGeo } from '../components/RideDetailRouteMap';
import { distanceMeters, getPositionAlongPolyline, type Point } from '../lib/geo';
import { getSharedTripTrackingUrl } from '../lib/publicWeb';
import {
  confirmRideBookingPayment,
  arriveAtStop,
  ratePassenger,
  registerPassengerDropoff,
  setRideAwaitingStopConfirmation,
} from '../backend/api';
import {
  DEFAULT_RATING_STARS,
  formatProfileRatingLabel,
  PROFILE_RATING_WINDOW,
} from '../lib/profileRating';
import {
  ARRIVE_GATE_M,
  ARRIVE_NEAR_BUS_M,
  driverNearArriveAnchor,
  boardedBookingsPendingDropoff,
  dropoffBookingsForArriveModal,
  extraPickupBookingsNearBus,
  nearestPublishedStopOrder,
  primaryDropoffBookingsForVisit,
  primaryPickupBookingsForVisit,
  type ArriveVisitKind,
} from '../lib/rideArriveVisit';
import { formatBookingTicketCode } from '../lib/bookingCode';
import { requestLocationPermission } from '../permissions';
import { getOriginForExternalNavigation } from '../location/getOriginForExternalNavigation';
import {
  startDriverTrackingInBackground,
  stopDriverTrackingInBackground,
  isDriverTrackingActive,
} from '../background/driverTrackingService';
type Nav = NativeStackNavigationProp<MainStackParamList, 'RideDetail'>;
type ScreenRoute = RouteProp<MainStackParamList, 'RideDetail'>;

/** No duplicar en el mapa el pin “otro pasajero” si coincide con tu subida/bajada/paradas extra. */
const CO_PASSENGER_DEDUP_M = 35;

type PassengerBookingSummary = {
  id: string;
  booking_code: string | null;
  status: string;
  seats_count: number;
  price_paid: number;
  pickup_stop_id: string | null;
  dropoff_stop_id: string | null;
  pickup_label: string | null;
  dropoff_label: string | null;
  payment_status: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
};

function polylineLengthMeters(points: Point[]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distanceMeters(points[i - 1], points[i]);
  }
  return total;
}

type DriverBookingStop = {
  id: string;
  booking_code: string | null;
  passenger_id: string;
  seats_count: number;
  status: string;
  pickup_stop_id: string | null;
  dropoff_stop_id: string | null;
  pickup_label: string | null;
  dropoff_label: string | null;
  price_paid: number;
  payment_status: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
};

function bookingPickupPoint(b: DriverBookingStop): Point | null {
  const lat = Number(b.pickup_lat);
  const lng = Number(b.pickup_lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function bookingDropoffPoint(b: DriverBookingStop): Point | null {
  const lat = Number(b.dropoff_lat);
  const lng = Number(b.dropoff_lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/** Misma tolerancia que para enlazar subida/bajada de la reserva con la parada publicada cuando falta el vínculo en la base. */
const BOOKING_TO_PUBLISHED_STOP_NEAR_M = 1800;

function bookingPickupNearPublishedStop(b: DriverBookingStop, stop: RideStopForReserve | undefined): boolean {
  if (!stop || b.status === 'cancelled') return false;
  if (b.pickup_stop_id != null && b.pickup_stop_id === stop.id) return true;
  if (b.pickup_stop_id != null) return false;
  const p = bookingPickupPoint(b);
  if (!p) return false;
  const slat = Number(stop.lat);
  const slng = Number(stop.lng);
  if (!Number.isFinite(slat) || !Number.isFinite(slng)) return false;
  return distanceMeters(p, { lat: slat, lng: slng }) <= BOOKING_TO_PUBLISHED_STOP_NEAR_M;
}

/** Maps/Waze: mismo criterio que los pins del mapa — subida/bajada del pasajero si existe; si no hay enlace en la base, el punto de reserva más cercano al pin de la parada publicada. */
function externalNavTargetForStop(
  stop: RideStopForReserve | undefined,
  bookings: DriverBookingStop[]
): Point | null {
  if (!stop) return null;
  const slat = Number(stop.lat);
  const slng = Number(stop.lng);
  if (!Number.isFinite(slat) || !Number.isFinite(slng)) return null;
  const stopCenter: Point = { lat: slat, lng: slng };
  const active = bookings.filter((b) => b.status !== 'cancelled');
  const nearM = BOOKING_TO_PUBLISHED_STOP_NEAR_M;

  for (const b of active) {
    if (b.pickup_stop_id != null && b.pickup_stop_id === stop.id) {
      const p = bookingPickupPoint(b);
      if (p) return p;
    }
  }
  for (const b of active) {
    if (b.dropoff_stop_id != null && b.dropoff_stop_id === stop.id) {
      const p = bookingDropoffPoint(b);
      if (p) return p;
    }
  }

  let best: { p: Point; d: number } | null = null;
  for (const b of active) {
    const p = bookingPickupPoint(b);
    if (!p) continue;
    const d = distanceMeters(p, stopCenter);
    if (d <= nearM && (!best || d < best.d)) best = { p, d };
  }
  if (best) return best.p;

  best = null;
  for (const b of active) {
    const p = bookingDropoffPoint(b);
    if (!p) continue;
    const d = distanceMeters(p, stopCenter);
    if (d <= nearM && (!best || d < best.d)) best = { p, d };
  }
  if (best) return best.p;

  return stopCenter;
}

type BoardingEventRow = { booking_id: string; stop_index: number; event_type: string };

type MapVisitProgress = 'done' | 'current' | 'upcoming';

function visitRowIsDone(
  row: OrderedMapVisitRow,
  boardingEvents: BoardingEventRow[],
  rideStopsSorted: RideStopForReserve[]
): boolean {
  if (row.kind === 'pickup' && row.bookingId) {
    return boardingEvents.some(
      (e) =>
        String(e.booking_id) === row.bookingId &&
        (e.event_type === 'boarded' ||
          e.event_type === 'no_show' ||
          e.event_type === 'stop_visited')
    );
  }
  if (row.kind === 'dropoff' && row.bookingId) {
    return boardingEvents.some(
      (e) =>
        String(e.booking_id) === row.bookingId &&
        (e.event_type === 'dropped_off' || e.event_type === 'stop_visited')
    );
  }
  if (row.kind === 'published' && row.rideStopId) {
    const idx = rideStopsSorted.findIndex((s) => s.id === row.rideStopId);
    if (idx < 0) return false;
    const stopMeta = rideStopsSorted[idx];
    return stopMeta?.arrived_at != null && String(stopMeta.arrived_at).length > 0;
  }
  return false;
}

/** Progreso por fila del recorrido: “En camino” = primera visita pendiente en orden del mapa. */
function resolveMapVisitProgressList(
  rows: OrderedMapVisitRow[],
  ctx: {
    status: string;
    boardingEvents: BoardingEventRow[];
    rideStopsSorted: RideStopForReserve[];
  }
): MapVisitProgress[] {
  const { status, boardingEvents, rideStopsSorted } = ctx;
  const doneFlags = rows.map((row) => visitRowIsDone(row, boardingEvents, rideStopsSorted));
  if (status !== 'en_route') {
    return doneFlags.map((d) => (d ? 'done' : 'upcoming'));
  }
  let win = -1;
  for (let i = 0; i < rows.length; i++) {
    if (!doneFlags[i]) {
      win = i;
      break;
    }
  }
  return rows.map((_, i) => {
    if (doneFlags[i]) return 'done';
    if (i === win) return 'current';
    return 'upcoming';
  });
}

/** Destino de navegación para una fila del recorrido ordenado (misma geometría que la lista). */
function navTargetForMapVisitRow(
  row: OrderedMapVisitRow,
  rideStopsSorted: RideStopForReserve[],
  bookings: DriverBookingStop[]
): Point | null {
  if (row.kind === 'pickup' && row.bookingId) {
    const b = bookings.find((x) => x.id === row.bookingId);
    if (!b || b.status === 'cancelled') return null;
    return bookingPickupPoint(b);
  }
  if (row.kind === 'dropoff' && row.bookingId) {
    const b = bookings.find((x) => x.id === row.bookingId);
    if (!b || b.status === 'cancelled') return null;
    return bookingDropoffPoint(b);
  }
  if (row.kind === 'published' && row.rideStopId) {
    const stop = rideStopsSorted.find((s) => s.id === row.rideStopId);
    return stop ? externalNavTargetForStop(stop, bookings) : null;
  }
  return null;
}

function formatSeatsLine(seats: number): string {
  const n = Math.max(1, Math.round(seats));
  return n === 1 ? '1 asiento' : `${n} asientos`;
}

/** Conductor: ticket grande; dirección y detalle secundarios (sobre todo en bloques desplegables). */
function ArrivePassengerRowHeader({
  kind,
  booking,
  showAmount,
  ticketEmphasis,
}: {
  kind: 'pickup' | 'dropoff';
  booking: DriverBookingStop;
  showAmount?: boolean;
  ticketEmphasis?: boolean;
}) {
  const ticket = formatBookingTicketCode(booking.booking_code);
  const place =
    kind === 'pickup'
      ? booking.pickup_label?.trim() || 'Punto de subida'
      : booking.dropoff_label?.trim() || 'Punto de bajada';
  const seats = Math.max(1, Number(booking.seats_count ?? 1));
  return (
    <>
      {ticket ? (
        <Text style={ticketEmphasis ? styles.arriveTicketHero : styles.arriveTicketCode}>{ticket}</Text>
      ) : (
        <Text style={styles.arriveTicketMissing}>Sin código de ticket</Text>
      )}
      <Text style={styles.arrivePlaceMuted} numberOfLines={2}>
        {kind === 'pickup' ? 'Subida' : 'Bajada'} · {place}
      </Text>
      <Text style={styles.arriveSeatsLine}>{formatSeatsLine(seats)}</Text>
      {showAmount ? (
        <Text style={styles.arriveAmount}>
          {booking.price_paid.toLocaleString('es-PY')} PYG · cobro al subir
        </Text>
      ) : null}
    </>
  );
}

function bookingStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return 'Pendiente';
    case 'confirmed':
      return 'Confirmada';
    case 'cancelled':
      return 'Cancelada';
    case 'completed':
      return 'Completada';
    default:
      return status || '—';
  }
}

/** Misma idea que la web: no cancelar con viaje en curso o reserva cerrada. */
function canPassengerCancelReservation(bookingStatus: string, rideStatus: string): boolean {
  if (bookingStatus === 'cancelled' || bookingStatus === 'completed') return false;
  if (bookingStatus !== 'pending' && bookingStatus !== 'confirmed') return false;
  const rs = String(rideStatus ?? '');
  if (rs === 'completed' || rs === 'cancelled' || rs === 'en_route') return false;
  return rs === 'published' || rs === 'booked';
}

/** Enlace de solo lectura para familiares (misma idea que otras apps de movilidad). */
function canPassengerShareSafetyTracking(
  booking: PassengerBookingSummary | null,
  rideStatus: string,
  shareCode: unknown,
  boardingEvents: BoardingEventRow[]
): boolean {
  if (!booking) return false;
  const code = typeof shareCode === 'string' ? shareCode.trim() : '';
  if (!code) return false;
  const bs = String(booking.status ?? '');
  if (bs === 'cancelled' || bs === 'completed') return false;
  if (bs !== 'pending' && bs !== 'confirmed') return false;
  if (String(rideStatus ?? '') !== 'en_route') return false;
  const bid = booking.id;
  if (
    boardingEvents.some(
      (e) => String(e.booking_id) === bid && String(e.event_type) === 'dropped_off'
    )
  ) {
    return false;
  }
  return true;
}

function friendlyStatusError(code: string | undefined, details?: string): string {
  switch (code) {
    case 'already_has_active_ride':
      return 'Ya tenés un viaje en curso. Finalizá ese antes de iniciar otro.';
    case 'account_suspended':
      return 'Tu cuenta está suspendida por deuda. No podés iniciar viajes nuevos hasta regularizar.';
    case 'operational_blocked':
      return (
        details ??
        'Tu cuenta tiene una restricción temporal por incumplimiento de viaje programado. Contactá a soporte.'
      );
    case 'start_too_early':
    case 'start_too_late':
    case 'no_departure_time':
    case 'cancel_high_occupancy':
    case 'cancel_too_late_low_fill':
      return details ?? 'No se pudo completar la acción en este momento.';
    case 'forbidden':
      return 'No tenés permiso para esta acción.';
    case 'unauthorized':
      return 'No pudimos confirmar la acción con el servidor. Cerrá sesión, volvé a entrar y probá otra vez. Si sigue igual, contactá a soporte.';
    case 'timeout':
    case 'network':
      return details ?? 'Problema de red o el servidor tardó demasiado. Intentá de nuevo.';
    case 'update_failed':
      return details ?? 'No se pudo actualizar el estado del viaje.';
    default:
      return details ?? 'No se pudo completar la acción. Intentá de nuevo.';
  }
}

export function RideDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<ScreenRoute>();
  const { session } = useAuth();
  const { rideId, publishSharePrompt } = route.params;
  const publishSharePromptShownRef = useRef(false);

  useEffect(() => {
    const code = publishSharePrompt?.code?.trim();
    if (!code || publishSharePromptShownRef.current) return;
    publishSharePromptShownRef.current = true;
    const msg = `Tu viaje quedó publicado.\n\nCódigo para compartir: ${code}${publishSharePrompt?.extraMessage ?? ''}`;
    const t = setTimeout(() => {
      Alert.alert('Listo', msg, [
        {
          text: 'Compartir código',
          onPress: () => {
            void Share.share({ message: `Código de viaje: ${code}` });
          },
        },
        { text: 'Omitir', style: 'cancel' },
      ]);
    }, 400);
    return () => clearTimeout(t);
  }, [publishSharePrompt]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ride, setRide] = useState<Record<string, unknown> | null>(null);
  const [rideStops, setRideStops] = useState<RideStopForReserve[]>([]);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [cancellingBooking, setCancellingBooking] = useState(false);
  const [contactingDriver, setContactingDriver] = useState(false);
  const [passengerBooking, setPassengerBooking] = useState<PassengerBookingSummary | null>(null);
  const [passengerExtrasGeo, setPassengerExtrasGeo] = useState<Point[]>([]);
  const [driverBookingPins, setDriverBookingPins] = useState<Array<{ pickup: Point; dropoff: Point }>>([]);
  const [coPassengerPickups, setCoPassengerPickups] = useState<Point[]>([]);
  const [coPassengerDropoffs, setCoPassengerDropoffs] = useState<Point[]>([]);
  const [driverRideBookings, setDriverRideBookings] = useState<DriverBookingStop[]>([]);
  const [driverLiveLocalGps, setDriverLiveLocalGps] = useState<Point | null>(null);
  const [bookingDetailsExpanded, setBookingDetailsExpanded] = useState(false);
  const [arriveModalOpen, setArriveModalOpen] = useState(false);
  const [arriveDecisions, setArriveDecisions] = useState<Record<string, 'boarded' | 'no_show' | 'dropped_off'>>({});
  const [arriveExtraExpanded, setArriveExtraExpanded] = useState(false);
  const [arriveDropExpanded, setArriveDropExpanded] = useState(false);
  const [arriveDriverPoint, setArriveDriverPoint] = useState<Point | null>(null);
  const [submittingArrive, setSubmittingArrive] = useState(false);
  /** Lista orden mapa (muchos ítems): colapsada por defecto. */
  const [mapRouteListExpanded, setMapRouteListExpanded] = useState(false);
  const [passengersOnBusExpanded, setPassengersOnBusExpanded] = useState(true);
  const [manualDropoffBookingId, setManualDropoffBookingId] = useState<string | null>(null);
  const [boardingEvents, setBoardingEvents] = useState<BoardingEventRow[]>([]);
  const [passengerRatingsGiven, setPassengerRatingsGiven] = useState<Set<string>>(new Set());
  const [ratePassengerModalOpen, setRatePassengerModalOpen] = useState(false);
  const [ratePassengerStars, setRatePassengerStars] = useState(DEFAULT_RATING_STARS);
  const [passengerToRate, setPassengerToRate] = useState<{ passengerId: string; displayName: string } | null>(
    null
  );
  const [submittingPassengerRating, setSubmittingPassengerRating] = useState(false);
  /** Evita re-render del mapa si el poll silencioso no cambió datos visibles (menos peticiones de ruta). */
  const rideVisualSigRef = useRef<string>('');

  const resolvedRideRoute = useRideResolvedPolyline(ride, rideStops);

  const loadPassengerBooking = useCallback(async () => {
    if (!session?.id) {
      setPassengerBooking(null);
      setPassengerExtrasGeo([]);
      return;
    }
    const { data, error } = await supabase
      .from('bookings')
      .select(
        'id, booking_code, status, seats_count, price_paid, pickup_stop_id, dropoff_stop_id, pickup_label, dropoff_label, payment_status, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng'
      )
      .eq('ride_id', rideId)
      .eq('passenger_id', session.id)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      setPassengerBooking(null);
      setPassengerExtrasGeo([]);
      return;
    }
    if (!data) {
      setPassengerBooking(null);
      setPassengerExtrasGeo([]);
      return;
    }
    setPassengerBooking({
      id: String(data.id),
      booking_code: data.booking_code != null ? String(data.booking_code) : null,
      status: String(data.status ?? ''),
      seats_count: Math.max(1, Number(data.seats_count ?? 1)),
      price_paid: Number(data.price_paid ?? 0),
      pickup_stop_id: data.pickup_stop_id != null ? String(data.pickup_stop_id) : null,
      dropoff_stop_id: data.dropoff_stop_id != null ? String(data.dropoff_stop_id) : null,
      pickup_label: data.pickup_label != null ? String(data.pickup_label) : null,
      dropoff_label: data.dropoff_label != null ? String(data.dropoff_label) : null,
      payment_status: data.payment_status != null ? String(data.payment_status) : null,
      pickup_lat: data.pickup_lat != null ? Number(data.pickup_lat) : null,
      pickup_lng: data.pickup_lng != null ? Number(data.pickup_lng) : null,
      dropoff_lat: data.dropoff_lat != null ? Number(data.dropoff_lat) : null,
      dropoff_lng: data.dropoff_lng != null ? Number(data.dropoff_lng) : null,
    });
    const { data: pesRows } = await supabase
      .from('passenger_extra_stops')
      .select('lat, lng')
      .eq('ride_id', rideId)
      .eq('passenger_id', session.id)
      .order('stop_order', { ascending: true });
    setPassengerExtrasGeo(
      (pesRows ?? [])
        .filter((r: { lat?: number; lng?: number }) => Number.isFinite(r.lat) && Number.isFinite(r.lng))
        .map((r: { lat: number; lng: number }) => ({ lat: r.lat, lng: r.lng }))
    );
  }, [rideId, session?.id]);

  /** Cuantización leve para no recalcular región del mapa en cada tick de GPS (menos parpadeo). */
  const driverLiveForMap = useMemo(() => {
    const p = driverLiveMapPoint(ride);
    if (!p) return null;
    return {
      lat: Math.round(p.lat * 10000) / 10000,
      lng: Math.round(p.lng * 10000) / 10000,
    };
  }, [
    ride ? String(ride.status ?? '') : '',
    ride ? String(ride.driver_lat ?? '') : '',
    ride ? String(ride.driver_lng ?? '') : '',
  ]);

  /** Fallback visual para conductor: si la DB tarda en reflejar driver_lat/lng, mostrar GPS local en su propio mapa. */
  useEffect(() => {
    const isOwnRide = Boolean(session?.id && ride && String(ride.driver_id) === String(session.id));
    const inProgress = String(ride?.status ?? '') === 'en_route';
    if (!isOwnRide || !inProgress) {
      setDriverLiveLocalGps(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        const lat = Number(loc.coords.latitude);
        const lng = Number(loc.coords.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        setDriverLiveLocalGps({ lat, lng });
      } catch {
        // ignore; mapa seguirá con dato de backend si existe
      }
    };
    void tick();
    const t = setInterval(() => {
      void tick();
    }, 5_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [session?.id, ride ? String(ride.driver_id ?? '') : '', ride ? String(ride.status ?? '') : '']);

  const driverLocationForMap = useMemo(
    () => driverLiveForMap ?? driverLiveLocalGps,
    [driverLiveForMap, driverLiveLocalGps]
  );
  const passengerPickupPoint = useMemo<Point | null>(() => {
    if (!passengerBooking) return null;
    const lat = Number(passengerBooking.pickup_lat);
    const lng = Number(passengerBooking.pickup_lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    const stopId = String(passengerBooking.pickup_stop_id ?? '').trim();
    if (!stopId) return null;
    const stop = rideStops.find((s) => String(s.id) === stopId);
    if (!stop) return null;
    if (!Number.isFinite(Number(stop.lat)) || !Number.isFinite(Number(stop.lng))) return null;
    return { lat: Number(stop.lat), lng: Number(stop.lng) };
  }, [passengerBooking, rideStops]);

  const passengerMapGeo = useMemo((): PassengerBookingMapGeo | null => {
    if (!passengerBooking) return null;
    const plat = passengerBooking.pickup_lat;
    const plng = passengerBooking.pickup_lng;
    const dlat = passengerBooking.dropoff_lat;
    const dlng = passengerBooking.dropoff_lng;
    if (
      plat == null ||
      plng == null ||
      dlat == null ||
      dlng == null ||
      ![plat, plng, dlat, dlng].every(Number.isFinite)
    ) {
      return null;
    }
    return {
      pickup: { lat: plat, lng: plng },
      dropoff: { lat: dlat, lng: dlng },
      extras: passengerExtrasGeo.length > 0 ? passengerExtrasGeo : undefined,
    };
  }, [passengerBooking, passengerExtrasGeo]);

  const mapCoPassengerPickups = useMemo(() => {
    if (!passengerMapGeo) return coPassengerPickups;
    const exclude = [passengerMapGeo.pickup, passengerMapGeo.dropoff, ...(passengerMapGeo.extras ?? [])];
    return coPassengerPickups.filter(
      (p) => !exclude.some((e) => distanceMeters(p, e) < CO_PASSENGER_DEDUP_M)
    );
  }, [coPassengerPickups, passengerMapGeo]);

  const mapCoPassengerDropoffs = useMemo(() => {
    if (!passengerMapGeo) return coPassengerDropoffs;
    const exclude = [passengerMapGeo.pickup, passengerMapGeo.dropoff, ...(passengerMapGeo.extras ?? [])];
    return coPassengerDropoffs.filter(
      (p) => !exclude.some((e) => distanceMeters(p, e) < CO_PASSENGER_DEDUP_M)
    );
  }, [coPassengerDropoffs, passengerMapGeo]);

  const refetchPassengerBoardingEvents = useCallback(async () => {
    if (!passengerBooking?.id || !rideId) {
      return;
    }
    if (String(ride?.status ?? '') !== 'en_route') {
      setBoardingEvents([]);
      return;
    }
    const { data: ev, error: evErr } = await supabase
      .from('ride_boarding_events')
      .select('booking_id, stop_index, event_type')
      .eq('ride_id', rideId)
      .eq('booking_id', passengerBooking.id);
    if (!evErr) setBoardingEvents((ev ?? []) as BoardingEventRow[]);
  }, [rideId, ride?.status, passengerBooking?.id]);

  const refetchDriverBookingPins = useCallback(async () => {
    if (!session?.id || !ride || String(ride.driver_id) !== String(session.id)) {
      setDriverBookingPins([]);
      setDriverRideBookings([]);
      return;
    }
    const { data, error } = await supabase
      .from('bookings')
      .select(
        'id, booking_code, passenger_id, seats_count, status, pickup_stop_id, dropoff_stop_id, pickup_label, dropoff_label, price_paid, payment_status, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng'
      )
      .eq('ride_id', rideId)
      .neq('status', 'cancelled');
    if (error) return;
    setDriverRideBookings(
      (data ?? []).map((row: Record<string, unknown>) => ({
        id: String(row.id ?? ''),
        booking_code: row.booking_code != null ? String(row.booking_code) : null,
        passenger_id: String(row.passenger_id ?? ''),
        seats_count: Math.max(1, Number(row.seats_count ?? 1)),
        status: String(row.status ?? ''),
        pickup_stop_id: row.pickup_stop_id != null ? String(row.pickup_stop_id) : null,
        dropoff_stop_id: row.dropoff_stop_id != null ? String(row.dropoff_stop_id) : null,
        pickup_label: row.pickup_label != null ? String(row.pickup_label) : null,
        dropoff_label: row.dropoff_label != null ? String(row.dropoff_label) : null,
        price_paid: Number(row.price_paid ?? 0),
        payment_status: row.payment_status != null ? String(row.payment_status) : null,
        pickup_lat: row.pickup_lat != null ? Number(row.pickup_lat) : null,
        pickup_lng: row.pickup_lng != null ? Number(row.pickup_lng) : null,
        dropoff_lat: row.dropoff_lat != null ? Number(row.dropoff_lat) : null,
        dropoff_lng: row.dropoff_lng != null ? Number(row.dropoff_lng) : null,
      }))
    );
    const pins = (data ?? [])
      .map((row: { pickup_lat?: number; pickup_lng?: number; dropoff_lat?: number; dropoff_lng?: number }) => ({
        pickup: { lat: Number(row.pickup_lat), lng: Number(row.pickup_lng) },
        dropoff: { lat: Number(row.dropoff_lat), lng: Number(row.dropoff_lng) },
      }))
      .filter((x) =>
        [x.pickup.lat, x.pickup.lng, x.dropoff.lat, x.dropoff.lng].every(Number.isFinite)
      );
    setDriverBookingPins(pins);

    if (String(ride.status ?? '') === 'en_route') {
      const [{ data: ev, error: evErr }, { data: pr }] = await Promise.all([
        supabase
          .from('ride_boarding_events')
          .select('booking_id, stop_index, event_type')
          .eq('ride_id', rideId),
        supabase.from('passenger_ratings').select('passenger_id').eq('ride_id', rideId),
      ]);
      if (!evErr) setBoardingEvents((ev ?? []) as BoardingEventRow[]);
      setPassengerRatingsGiven(
        new Set((pr ?? []).map((r: { passenger_id: string }) => String(r.passenger_id)))
      );
    } else {
      setBoardingEvents([]);
      setPassengerRatingsGiven(new Set());
    }
  }, [rideId, session?.id, ride]);

  const refetchCoPassengerMapPoints = useCallback(async () => {
    if (!rideId) return;
    if (!ride) {
      setCoPassengerPickups([]);
      setCoPassengerDropoffs([]);
      return;
    }
    const isDriver = Boolean(session?.id && String(ride.driver_id) === String(session.id));
    if (isDriver) {
      setCoPassengerPickups([]);
      setCoPassengerDropoffs([]);
      return;
    }
    try {
      const { pickups, dropoffs } = await fetchRidePublicMapPoints(rideId);
      setCoPassengerPickups(pickups);
      setCoPassengerDropoffs(dropoffs);
    } catch {
      setCoPassengerPickups([]);
      setCoPassengerDropoffs([]);
    }
  }, [rideId, session?.id, ride]);

  const load = useCallback(async (opts?: { quiet?: boolean }): Promise<Record<string, unknown> | null> => {
    const quiet = Boolean(opts?.quiet);
    if (!quiet) {
      setLoading(true);
      setError(null);
    }
    try {
      const res = await fetchRideForReserve(rideId);
      if (!res?.ride) {
        /** Solo la carga visible puede vaciar el estado: un poll/focus silencioso no debe borrar un viaje ya mostrado (red/RLS transitorio). */
        if (!quiet) {
          setError('Viaje no encontrado.');
          rideVisualSigRef.current = '';
          setRide(null);
          setRideStops([]);
        }
        return null;
      }
      const nextRide = res.ride;
      const stops = res.ride_stops ?? [];
      const br = nextRide.base_route_polyline;
      const brLen = Array.isArray(br) ? br.length : 0;
      const stopsSig = stops.map((s) => `${s.id}:${s.stop_order}:${s.lat},${s.lng}`).join(';');
      const sig = [
        String(nextRide.id ?? ''),
        String(nextRide.status ?? ''),
        String(nextRide.driver_lat ?? ''),
        String(nextRide.driver_lng ?? ''),
        brLen,
        String(nextRide.current_stop_index ?? ''),
        String(nextRide.awaiting_stop_confirmation ?? ''),
        stopsSig,
      ].join('|');
      if (quiet && sig === rideVisualSigRef.current) {
        return nextRide as Record<string, unknown>;
      }
      rideVisualSigRef.current = sig;
      setRide(nextRide);
      setRideStops(stops);
      return nextRide as Record<string, unknown>;
    } catch (e) {
      if (!quiet) setError(e instanceof Error ? e.message : 'Error al cargar');
      return null;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [rideId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    void refetchDriverBookingPins();
  }, [refetchDriverBookingPins]);

  useEffect(() => {
    void refetchPassengerBoardingEvents();
  }, [refetchPassengerBoardingEvents]);

  useEffect(() => {
    void refetchCoPassengerMapPoints();
  }, [refetchCoPassengerMapPoints]);

  const promptRatePassengerAfterDrop = useCallback(
    async (droppedBookings: DriverBookingStop[]) => {
      if (droppedBookings.length === 0) return;
      const { data: pr } = await supabase
        .from('passenger_ratings')
        .select('passenger_id')
        .eq('ride_id', rideId);
      const rated = new Set((pr ?? []).map((r: { passenger_id: string }) => String(r.passenger_id)));
      setPassengerRatingsGiven(rated);
      const first = droppedBookings.find((b) => b.passenger_id && !rated.has(b.passenger_id));
      if (!first?.passenger_id) return;
      let displayName = formatBookingTicketCode(first.booking_code) || first.pickup_label?.trim() || 'Pasajero';
      const { data: prof } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', first.passenger_id)
        .maybeSingle();
      if (prof?.full_name && String(prof.full_name).trim()) {
        displayName = String(prof.full_name).trim();
      }
      setPassengerToRate({ passengerId: first.passenger_id, displayName });
      setRatePassengerStars(DEFAULT_RATING_STARS);
      setRatePassengerModalOpen(true);
    },
    [rideId]
  );

  const submitManualDropoff = useCallback(
    async (booking: DriverBookingStop) => {
      if (manualDropoffBookingId) return;
      setManualDropoffBookingId(booking.id);
      try {
        const res = await registerPassengerDropoff(rideId, booking.id);
        if (!res.ok) {
          Alert.alert('No se pudo registrar', res.error ?? 'Intentá de nuevo.');
          return;
        }
        rideVisualSigRef.current = '';
        await load({ quiet: true });
        await refetchDriverBookingPins();
        await promptRatePassengerAfterDrop([booking]);
        Alert.alert('Listo', 'Bajada registrada.');
      } finally {
        setManualDropoffBookingId(null);
      }
    },
    [manualDropoffBookingId, rideId, load, refetchDriverBookingPins, promptRatePassengerAfterDrop]
  );

  const confirmManualDropoff = useCallback(
    (booking: DriverBookingStop) => {
      const label =
        formatBookingTicketCode(booking.booking_code) ||
        booking.dropoff_label?.trim() ||
        booking.pickup_label?.trim() ||
        'este pasajero';
      Alert.alert('Confirmar bajada', `¿${label} bajó del minibús?`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Bajó', onPress: () => void submitManualDropoff(booking) },
      ]);
    },
    [submitManualDropoff]
  );

  const submitRatePassenger = useCallback(async () => {
    if (!passengerToRate || ratePassengerStars < 1 || ratePassengerStars > 5 || submittingPassengerRating) {
      return;
    }
    setSubmittingPassengerRating(true);
    try {
      await ratePassenger(rideId, passengerToRate.passengerId, ratePassengerStars);
      setPassengerRatingsGiven((prev) => new Set(prev).add(passengerToRate.passengerId));
      setRatePassengerModalOpen(false);
      setPassengerToRate(null);
      Alert.alert('Gracias', 'Calificación del pasajero registrada.');
    } catch (e) {
      Alert.alert(
        'No se pudo calificar',
        e instanceof Error ? e.message : 'Intentá de nuevo en un momento.'
      );
    } finally {
      setSubmittingPassengerRating(false);
    }
  }, [rideId, passengerToRate, ratePassengerStars, submittingPassengerRating]);

  useFocusEffect(
    useCallback(() => {
      void load({ quiet: true });
      void loadPassengerBooking();
      void refetchPassengerBoardingEvents();
      void refetchDriverBookingPins();
      void refetchCoPassengerMapPoints();
      if (
        session?.id &&
        ride &&
        String(ride.driver_id) === String(session.id) &&
        String(ride.status ?? '') === 'en_route'
      ) {
        void (async () => {
          const active = await isDriverTrackingActive();
          if (!active) await startDriverTrackingInBackground(rideId);
        })();
      }
    }, [
      load,
      loadPassengerBooking,
      refetchPassengerBoardingEvents,
      refetchDriverBookingPins,
      refetchCoPassengerMapPoints,
      session?.id,
      ride,
      rideId,
    ])
  );

  const handleCancelPassengerBooking = useCallback(() => {
    if (!session?.id || !passengerBooking) return;
    Alert.alert(
      'Cancelar reserva',
      '¿Querés cancelar esta reserva? Los cupos del viaje se liberarán para otros pasajeros.',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Sí, cancelar',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setCancellingBooking(true);
              try {
                await cancelBooking(passengerBooking.id, session.id);
                await loadPassengerBooking();
                await load({ quiet: true });
                Alert.alert('Listo', 'Tu reserva fue cancelada.');
              } catch (e) {
                Alert.alert(
                  'No se pudo cancelar',
                  e instanceof Error ? e.message : 'Intentá de nuevo en un momento.'
                );
              } finally {
                setCancellingBooking(false);
              }
            })();
          },
        },
      ]
    );
  }, [session?.id, passengerBooking, load, loadPassengerBooking]);

  const handleSharePassengerSafetyTracking = useCallback(() => {
    const code = ride?.share_code != null ? String(ride.share_code).trim() : '';
    const url = getSharedTripTrackingUrl(code, passengerBooking?.id);
    if (!url) {
      Alert.alert(
        'No disponible',
        'No pudimos armar el enlace. Revisá que EXPO_PUBLIC_API_BASE_URL apunte al sitio web y actualizá esta pantalla.'
      );
      return;
    }
    const message = `Seguí mi viaje en ÑandeBus (solo lectura). El enlace deja de actualizarse cuando baje del minibús:\n${url}`;
    void Share.share(Platform.OS === 'ios' ? { message, url } : { message });
  }, [ride?.share_code, passengerBooking?.id]);

  /** Poll de UI: pasajero con reserva ve avances y pin en mapa sin salir de pantalla. */
  useEffect(() => {
    if (!ride) return;
    const st = String(ride.status ?? '');
    const isDriver = Boolean(session?.id && String(ride.driver_id) === String(session.id));
    const isPassengerWithBooking = Boolean(
      session?.id && passengerBooking && String(ride.driver_id) !== String(session.id)
    );
    const driverNeedsTick = isDriver;
    const passengerNeedsTick =
      isPassengerWithBooking && st !== 'completed' && st !== 'cancelled';
    if (!driverNeedsTick && !passengerNeedsTick) return;

    const t = setInterval(() => {
      void load({ quiet: true });
      void loadPassengerBooking();
      if (isPassengerWithBooking) void refetchPassengerBoardingEvents();
      if (isDriver) {
        void refetchDriverBookingPins();
        if (st === 'en_route') {
          void (async () => {
            const active = await isDriverTrackingActive();
            if (!active) await startDriverTrackingInBackground(rideId);
          })();
        }
      }
      if (isPassengerWithBooking) void refetchCoPassengerMapPoints();
    }, 22_000);
    return () => clearInterval(t);
  }, [
    ride,
    session?.id,
    passengerBooking?.id,
    load,
    loadPassengerBooking,
    refetchDriverBookingPins,
    refetchCoPassengerMapPoints,
    refetchPassengerBoardingEvents,
  ]);

  useEffect(() => {
    if (!ride || !session?.id) return;
    if (String(ride.driver_id) !== String(session.id)) return;
    const st = String(ride.status ?? '');
    let cancelled = false;
    void (async () => {
      if (st === 'en_route') {
        const ok = await startDriverTrackingInBackground(rideId);
        if (!ok && !cancelled) {
          Alert.alert(
            'Ubicación en segundo plano',
            'Para iniciar viaje se requiere ubicación en segundo plano. Activá el permiso y reintentá.'
          );
        }
        return;
      }
      if (st === 'completed' || st === 'cancelled') {
        await stopDriverTrackingInBackground();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ride, rideId, session?.id]);

  const runStatusUpdate = useCallback(
    (next: 'en_route' | 'completed' | 'cancelled') => {
      const title =
        next === 'en_route' ? 'Iniciar viaje' : next === 'completed' ? 'Finalizar viaje' : 'Cancelar viaje';
      const message =
        next === 'en_route'
          ? 'Los pasajeros verán el viaje como en camino. ¿Confirmás?'
          : next === 'completed'
            ? '¿Marcar el viaje como completado?'
            : '¿Cancelar este viaje? Se notificará a los pasajeros y, si viene de sistema, volverá a despacho.';
      Alert.alert(title, message, [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: next === 'en_route' ? 'Iniciar' : next === 'completed' ? 'Finalizar' : 'Sí, cancelar',
          style: next === 'completed' || next === 'cancelled' ? 'destructive' : 'default',
          onPress: () => {
            void (async () => {
              setStatusUpdating(true);
              try {
                const r = await updateRideStatus(rideId, next, '');
                if (!r.ok) {
                  Alert.alert('No se pudo actualizar', friendlyStatusError(r.error, r.details));
                  return;
                }
                const refreshed = await load({ quiet: true });
                if (next === 'en_route') {
                  await startDriverTrackingInBackground(rideId);
                  Alert.alert('Listo', 'El viaje quedó en curso.');
                } else if (next === 'completed') {
                  await stopDriverTrackingInBackground();
                  Alert.alert('Listo', 'Viaje finalizado.');
                } else {
                  await stopDriverTrackingInBackground();
                  Alert.alert(
                    'Listo',
                    'Viaje cancelado. Si venía de sistema/demanda, quedó disponible para reasignación.'
                  );
                  navigation.goBack();
                }
              } finally {
                setStatusUpdating(false);
              }
            })();
          },
        },
      ]);
    },
    [rideId, load, navigation, session?.id]
  );

  /**
   * Ingresos conductor: debe ir con el resto de hooks antes de cualquier return condicional.
   */
  const driverBookingRevenue = useMemo(() => {
    const rows = driverRideBookings.filter((b) => b.status !== 'cancelled');
    let totalGs = 0;
    let paidGs = 0;
    for (const b of rows) {
      const amt = Math.max(0, Math.round(Number(b.price_paid ?? 0)));
      if (!Number.isFinite(amt)) continue;
      totalGs += amt;
      if (String(b.payment_status ?? '').toLowerCase() === 'paid') {
        paidGs += amt;
      }
    }
    const pendingGs = Math.max(0, totalGs - paidGs);
    return { count: rows.length, totalGs, paidGs, pendingGs };
  }, [driverRideBookings]);

  const mapVisitOrderRows = useMemo((): OrderedMapVisitRow[] => {
    if (rideStops.length === 0) return [];
    const pts = resolvedRideRoute.points;
    if (pts.length < 2) {
      return filterOperationalDriverStops([...rideStops])
        .sort((a, b) => a.stop_order - b.stop_order)
        .map((s) => ({
          kind: 'published' as const,
          lat: s.lat,
          lng: s.lng,
          title: s.label?.trim() || 'Punto de tu ruta publicada',
          rideStopId: s.id,
          stopOrder: s.stop_order,
        }));
    }
    return computeOrderedVisitStopsForMap({
      driverBaseRoute: pts,
      driverStops: rideStops.map((s) => ({
        id: s.id,
        lat: s.lat,
        lng: s.lng,
        label: s.label,
        stop_order: s.stop_order,
        is_base_stop: s.is_base_stop,
      })),
      bookings: driverRideBookings.map((b) => ({
        id: b.id,
        status: b.status,
        pickup_lat: b.pickup_lat,
        pickup_lng: b.pickup_lng,
        dropoff_lat: b.dropoff_lat,
        dropoff_lng: b.dropoff_lng,
        pickup_label: b.pickup_label,
        dropoff_label: b.dropoff_label,
      })),
    });
  }, [resolvedRideRoute.points, rideStops, driverRideBookings]);

  const mapVisitProgressList = useMemo((): MapVisitProgress[] => {
    if (mapVisitOrderRows.length === 0) return [];
    if (!ride || rideStops.length === 0) {
      return mapVisitOrderRows.map(() => 'upcoming' as MapVisitProgress);
    }
    const st = String(ride.status ?? '');
    return resolveMapVisitProgressList(mapVisitOrderRows, {
      status: st,
      boardingEvents,
      rideStopsSorted: rideStops,
    });
  }, [ride, rideStops, mapVisitOrderRows, boardingEvents]);

  const currentVisitIndex = useMemo(
    () => mapVisitProgressList.findIndex((p) => p === 'current'),
    [mapVisitProgressList]
  );

  const currentVisitRow = useMemo((): OrderedMapVisitRow | null => {
    if (currentVisitIndex < 0) return null;
    return mapVisitOrderRows[currentVisitIndex] ?? null;
  }, [currentVisitIndex, mapVisitOrderRows]);

  const orderedNavigationTarget = useMemo((): Point | null => {
    if (!ride || String(ride.status ?? '') !== 'en_route' || !currentVisitRow) return null;
    const t = navTargetForMapVisitRow(currentVisitRow, rideStops, driverRideBookings);
    if (t && Number.isFinite(t.lat) && Number.isFinite(t.lng)) return t;
    return null;
  }, [ride, rideStops, currentVisitRow, driverRideBookings]);

  /** Antes de cualquier return: useCallback no puede ir después de branches (Rules of Hooks). */
  const canContactDriver = useMemo(() => {
    if (!ride) return false;
    const isOwnPassengerView = Boolean(session?.id && ride.driver_id === session.id);
    if (isOwnPassengerView || !passengerBooking) return false;
    const st = String(ride.status ?? '');
    if (st !== 'published' && st !== 'booked' && st !== 'en_route') return false;
    if (st === 'en_route') return true;
    const depIso = ride.departure_time ? String(ride.departure_time) : '';
    const departureAt = depIso ? new Date(depIso) : null;
    const nowMs = Date.now();
    const contactWindowStartMs = departureAt ? departureAt.getTime() - 20 * 60 * 1000 : null;
    return contactWindowStartMs != null && nowMs >= contactWindowStartMs;
  }, [ride, passengerBooking, session?.id]);

  const handleContactDriver = useCallback(async () => {
    if (!canContactDriver || contactingDriver) return;
    setContactingDriver(true);
    try {
      const r = await ensureRideContactConversation(rideId);
      if (r.conversationId) {
        navigation.navigate('Chat', { conversationId: r.conversationId });
        return;
      }
      Alert.alert('Contacto no disponible', r.errorMessage ?? 'No se pudo abrir el chat con el conductor.');
    } finally {
      setContactingDriver(false);
    }
  }, [canContactDriver, contactingDriver, rideId, navigation]);

  /** Botón bajo perfil del conductor: visible con reserva válida; atenuado hasta la ventana de contacto. */
  const passengerDriverContactInCard = useMemo(() => {
    if (!ride) return { show: false as const };
    const isOwnPassengerView = Boolean(session?.id && ride.driver_id === session.id);
    if (isOwnPassengerView || !passengerBooking) return { show: false as const };
    const bst = String(passengerBooking.status ?? '');
    if (bst !== 'pending' && bst !== 'confirmed') return { show: false as const };
    const st = String(ride.status ?? '');
    if (st !== 'published' && st !== 'booked' && st !== 'en_route') return { show: false as const };
    return {
      show: true as const,
      enabled: canContactDriver,
      hintDisabled: 'Se habilita 20 minutos antes de iniciar el viaje.',
    };
  }, [ride, passengerBooking, session?.id, canContactDriver]);

  const visitKind: ArriveVisitKind = currentVisitRow?.kind ?? 'published';
  const visitBookingId = currentVisitRow?.bookingId;
  const arriveAnchor = orderedNavigationTarget;
  const arriveDriverForLists = arriveDriverPoint ?? driverLocationForMap ?? arriveAnchor;

  const primaryArrivePickups = useMemo(() => {
    if (visitKind !== 'pickup') return [] as DriverBookingStop[];
    return primaryPickupBookingsForVisit(
      driverRideBookings,
      boardingEvents,
      visitBookingId
    ) as DriverBookingStop[];
  }, [visitKind, visitBookingId, driverRideBookings, boardingEvents]);

  const primaryArriveDropoffs = useMemo(() => {
    if (visitKind !== 'dropoff') return [] as DriverBookingStop[];
    return primaryDropoffBookingsForVisit(
      driverRideBookings,
      boardingEvents,
      visitBookingId
    ) as DriverBookingStop[];
  }, [visitKind, visitBookingId, driverRideBookings, boardingEvents]);

  const primaryArriveIds = useMemo(() => {
    const s = new Set<string>();
    for (const b of primaryArrivePickups) s.add(b.id);
    for (const b of primaryArriveDropoffs) s.add(b.id);
    return s;
  }, [primaryArrivePickups, primaryArriveDropoffs]);

  const extraArrivePickups = useMemo(() => {
    if (!arriveDriverForLists) return [] as DriverBookingStop[];
    return extraPickupBookingsNearBus(
      driverRideBookings,
      boardingEvents,
      arriveDriverForLists,
      primaryArriveIds
    ) as DriverBookingStop[];
  }, [driverRideBookings, boardingEvents, arriveDriverForLists, primaryArriveIds]);

  const dropoffArriveList = useMemo(() => {
    if (!arriveDriverForLists || !arriveAnchor) return [] as DriverBookingStop[];
    return dropoffBookingsForArriveModal(
      driverRideBookings,
      boardingEvents,
      arriveDriverForLists,
      resolvedRideRoute.points,
      visitKind,
      visitBookingId,
      arriveAnchor
    ) as DriverBookingStop[];
  }, [
    driverRideBookings,
    boardingEvents,
    arriveDriverForLists,
    resolvedRideRoute.points,
    visitKind,
    visitBookingId,
    arriveAnchor,
  ]);

  const passengersOnBus = useMemo((): DriverBookingStop[] => {
    const pending = boardedBookingsPendingDropoff(driverRideBookings, boardingEvents);
    const base = resolvedRideRoute.points;
    if (base.length < 2) return pending as DriverBookingStop[];
    return [...pending].sort((a, b) => {
      const pa = bookingDropoffPoint(a as DriverBookingStop);
      const pb = bookingDropoffPoint(b as DriverBookingStop);
      if (!pa || !pb) return 0;
      const ta = getPositionAlongPolyline(pa, base);
      const tb = getPositionAlongPolyline(pb, base);
      if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
      return 0;
    }) as DriverBookingStop[];
  }, [driverRideBookings, boardingEvents, resolvedRideRoute.points]);

  const arriveModalHasPassengers =
    primaryArrivePickups.length > 0 ||
    primaryArriveDropoffs.length > 0 ||
    extraArrivePickups.length > 0 ||
    dropoffArriveList.length > 0;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="appBrand.colors.primary" />
      </View>
    );
  }

  if (error || !ride) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error ?? 'No disponible'}</Text>
        <TouchableOpacity style={styles.btn} onPress={() => navigation.goBack()}>
          <Text style={styles.btnText}>Volver</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const driver = ride.driver as {
    full_name?: string;
    rating_average?: number;
    rating_count?: number;
    avatar_url?: string | null;
    vehicle_photo_url?: string | null;
  } | null;
  const isOwn = Boolean(session?.id && ride.driver_id === session.id);
  const driverRatingLabel = driver
    ? formatProfileRatingLabel(driver.rating_average, driver.rating_count)
    : null;
  const available = Math.max(0, Number(ride.available_seats ?? 0));
  const totalSeats = Math.max(0, Number(ride.total_seats ?? 0));
  const status = String(ride.status ?? '');
  /** Conductor con viaje en curso: UI más compacta (mapa + acciones; sin textos repetidos de publicación). */
  const driverUiEnRoute = isOwn && status === 'en_route';
  const depIso = ride.departure_time ? String(ride.departure_time) : '';
  const priceSeat = Number(ride.price_per_seat ?? 0);
  const description = ride.description != null ? String(ride.description).trim() : '';
  const routeNameLine = ride.route_name != null ? String(ride.route_name).trim() : '';
  const durMin = Number(ride.estimated_duration_minutes ?? 0);
  const flexible = Boolean(ride.flexible_departure);
  const maxDevKm = Number(ride.max_deviation_km ?? 0);
  const vehicleInfo = ride.vehicle_info as { model?: string; year?: number } | null | undefined;
  const vehicleLine =
    vehicleInfo && (String(vehicleInfo.model ?? '').trim() || vehicleInfo.year != null)
      ? [String(vehicleInfo.model ?? '').trim(), vehicleInfo.year != null ? String(vehicleInfo.year) : '']
          .filter(Boolean)
          .join(' · ')
      : '';
  const stCfg = rideStatusConfig(status);

  const awaitingStop = Boolean(ride.awaiting_stop_confirmation);
  const passengerEtaToPickupMin = (() => {
    if (isOwn || status !== 'en_route') return null;
    if (!driverLocationForMap || !passengerPickupPoint) return null;
    const routePoints = resolvedRideRoute.points;
    const routeLen = polylineLengthMeters(routePoints);
    let meters = distanceMeters(driverLocationForMap, passengerPickupPoint);
    if (routeLen > 0 && routePoints.length >= 2) {
      const tDriver = getPositionAlongPolyline(driverLocationForMap, routePoints);
      const tPickup = getPositionAlongPolyline(passengerPickupPoint, routePoints);
      if (Number.isFinite(tDriver) && Number.isFinite(tPickup) && tPickup >= tDriver) {
        meters = Math.max(20, (tPickup - tDriver) * routeLen);
      }
    }
    if (!Number.isFinite(meters) || meters <= 0) return null;
    // ETA aproximado para mostrar progreso en vivo sin bloquear UI.
    const avgCitySpeedKmh = 28;
    return Math.max(1, Math.round((meters / 1000 / avgCitySpeedKmh) * 60));
  })();
  const allVisitsDone =
    mapVisitOrderRows.length > 0 && mapVisitProgressList.every((p) => p === 'done');
  const canCompleteByStops = mapVisitOrderRows.length === 0 || allVisitsDone;
  const hasActiveVisit = currentVisitIndex >= 0;

  const canStart = isOwn && (status === 'published' || status === 'booked');
  const canComplete = isOwn && status === 'en_route' && canCompleteByStops && !awaitingStop;
  const canCancel = isOwn && (status === 'published' || status === 'booked' || status === 'draft');
  const canEdit =
    isOwn && status !== 'en_route' && status !== 'completed' && status !== 'cancelled';

  const openExternalNavigation = async (lat: number, lng: number) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      Alert.alert('Navegación', 'No hay una ubicación válida para abrir el mapa.');
      return;
    }
    try {
      const pref = await getNavigationPreference();
      let origin: { lat: number; lng: number } | undefined;
      if (await requestLocationPermission()) {
        origin = await getOriginForExternalNavigation();
      }
      const result = await openNavigation(lat, lng, pref, {
        ...(origin ? { origin } : {}),
      });
      if (!result.ok) {
        const { title, body } = openNavigationErrorMessage(pref, result.error);
        Alert.alert(title, body);
      }
    } catch (e) {
      Alert.alert(
        'Navegación',
        e instanceof Error ? e.message : 'No se pudo abrir la app de mapas. Reintentá o revisá que Maps esté instalado.'
      );
    }
  };

  const openArriveModal = async () => {
    if (!currentVisitRow || !arriveAnchor) {
      Alert.alert('Punto', 'No hay un punto pendiente en el recorrido para confirmar.');
      return;
    }
    try {
      const perm = await requestLocationPermission();
      if (perm) {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const driverPt = {
          lat: Number(loc.coords.latitude),
          lng: Number(loc.coords.longitude),
        };
        setArriveDriverPoint(driverPt);
        if (
          !driverNearArriveAnchor(
            driverPt.lat,
            driverPt.lng,
            arriveAnchor.lat,
            arriveAnchor.lng,
            ARRIVE_GATE_M
          )
        ) {
          const d = distanceMeters(driverPt, arriveAnchor);
          Alert.alert(
            'Aún no llegaste al punto',
            `Estás a ${Math.round(d)} m. Acercate a menos de ${ARRIVE_GATE_M} m para usar "Llegué".`
          );
          return;
        }
      }
    } catch {
      // Si no se puede medir localmente, el backend valida al confirmar.
    }
    const r = await setRideAwaitingStopConfirmation(rideId, true);
    if (!r.ok) {
      const errMsg = String(r.error ?? '');
      const looksLikeAuth = /sesi[oó]n|no autorizado|unauthorized|token/i.test(errMsg);
      if (!looksLikeAuth) {
        Alert.alert(
          'Aviso',
          'No pudimos registrar el estado intermedio de llegada, pero podés confirmar la parada igual.'
        );
      }
    }
    setArriveDecisions({});
    setArriveExtraExpanded(false);
    setArriveDropExpanded(false);
    setArriveModalOpen(true);
    rideVisualSigRef.current = '';
    await load({ quiet: true });
  };

  const submitArriveModal = async () => {
    if (!arriveAnchor || !currentVisitRow || submittingArrive) return;
    setSubmittingArrive(true);
    try {
      const perm = await requestLocationPermission();
      if (!perm) {
        Alert.alert(
          'Ubicación',
          'Para confirmar la parada el servidor necesita tu ubicación. Activá el permiso de ubicación e intentá de nuevo.'
        );
        return;
      }
      let driverLat: number;
      let driverLng: number;
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        driverLat = loc.coords.latitude;
        driverLng = loc.coords.longitude;
        setArriveDriverPoint({ lat: driverLat, lng: driverLng });
      } catch {
        Alert.alert('Ubicación', 'No se pudo leer tu posición. Revisá que el GPS esté activo e intentá de nuevo.');
        return;
      }
      const pickupRows = [...primaryArrivePickups, ...extraArrivePickups];
      const dropRows = [...primaryArriveDropoffs, ...dropoffArriveList];
      const passengers: Array<{ id: string; action: 'boarded' | 'no_show' | 'dropped_off' }> = [];
      for (const b of pickupRows) {
        const v = arriveDecisions[`pickup:${b.id}`];
        if (v === 'boarded' || v === 'no_show') {
          passengers.push({ id: b.id, action: v });
        }
      }
      for (const b of dropRows) {
        if (arriveDecisions[`dropoff:${b.id}`] === 'dropped_off') {
          passengers.push({ id: b.id, action: 'dropped_off' });
        }
      }
      const stopOrder =
        nearestPublishedStopOrder(
          rideStops.map((s) => ({
            id: s.id,
            lat: s.lat,
            lng: s.lng,
            stop_order: s.stop_order,
            is_base_stop: s.is_base_stop,
          })),
          arriveAnchor.lat,
          arriveAnchor.lng
        ) ??
        currentVisitRow.stopOrder ??
        0;

      const arrive = await arriveAtStop(rideId, {
        stopOrder,
        passengers,
        anchorLat: arriveAnchor.lat,
        anchorLng: arriveAnchor.lng,
        visitKind,
        visitBookingId,
        driverLat,
        driverLng,
      });
      if (!arrive.ok) {
        const code = (arrive.data as { code?: string } | undefined)?.code;
        const msg =
          code === 'driver_too_far_from_stop'
            ? String((arrive.data as { error?: string })?.error ?? arrive.error ?? 'Acercate más al punto.')
            : (arrive.error ?? 'Intentá de nuevo.');
        Alert.alert('No se pudo confirmar', msg);
        return;
      }
      const arrivedBody = arrive.data as { current_stop_index?: unknown } | undefined;
      const nextIdx = arrivedBody?.current_stop_index;
      if (typeof nextIdx === 'number' && Number.isFinite(nextIdx)) {
        setRide((r) => (r ? { ...r, current_stop_index: nextIdx } : r));
      }
      const droppedExplicit = dropRows.filter(
        (b) => arriveDecisions[`dropoff:${b.id}`] === 'dropped_off'
      );
      for (const b of pickupRows) {
        if (arriveDecisions[`pickup:${b.id}`] === 'boarded') {
          const paid = await confirmRideBookingPayment(rideId, b.id);
          if (!paid.ok) {
            Alert.alert(
              'Cobro pendiente',
              `Subió pero no se pudo registrar el cobro de ${b.price_paid.toLocaleString('es-PY')} PYG.`
            );
          }
        }
      }
      setArriveModalOpen(false);
      setArriveDriverPoint(null);
      rideVisualSigRef.current = '';
      await load({ quiet: true });
      await refetchDriverBookingPins();
      await promptRatePassengerAfterDrop(droppedExplicit);
      Alert.alert('Listo', 'Punto confirmado.');
    } finally {
      setSubmittingArrive(false);
    }
  };

  return (
    <View style={styles.flexFill}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        nestedScrollEnabled={Platform.OS === 'android'}
        removeClippedSubviews={Platform.OS === 'android' ? false : undefined}
        keyboardShouldPersistTaps="handled"
      >
      {isOwn ? (
        <>
          <View style={[styles.statusPill, { borderColor: stCfg.color }]}>
            <View style={[styles.statusDot, { backgroundColor: stCfg.color }]} />
            <Text style={[styles.statusPillText, { color: stCfg.color }]}>{stCfg.label}</Text>
          </View>
          {driverUiEnRoute ? null : (
            <>
              <Text style={styles.sectionLabel}>Ruta</Text>
              {routeNameLine ? <Text style={styles.routeNameLine}>{routeNameLine}</Text> : null}
              <Text style={styles.title}>
                {String(ride.origin_label ?? 'Origen')} → {String(ride.destination_label ?? 'Destino')}
              </Text>
            </>
          )}
          <RideDetailRouteMap
            ride={ride}
            rideStops={rideStops}
            resolvedRoute={resolvedRideRoute}
            resolvedRouteLoading={resolvedRideRoute.loading}
            height={300}
            otherBookingsGeo={driverBookingPins}
            driverLocation={driverLocationForMap}
            driverEnRouteNavFocus={driverUiEnRoute ? orderedNavigationTarget : null}
            hidePolylineSourceNote={driverUiEnRoute}
          />
          {driverUiEnRoute ? null : (
            <>
              <Text style={styles.sectionLabel}>Salida</Text>
              <Text style={styles.bodyLine}>
                {formatRideDate(depIso)} · {formatRideTime(depIso)}
              </Text>
              <Text style={styles.bodyMuted}>
                {flexible ? 'Ventana ±30 min alrededor de la hora' : 'Salida a horario acordado (±5 min)'}
              </Text>
              {durMin > 0 ? (
                <>
                  <Text style={styles.sectionLabel}>Duración estimada</Text>
                  <Text style={styles.bodyLine}>{durMin} minutos</Text>
                </>
              ) : null}
              <Text style={styles.sectionLabel}>Asientos</Text>
              <Text style={styles.bodyLine}>
                {available} libres
                {totalSeats > 0 ? ` de ${totalSeats}` : ''}
              </Text>
            </>
          )}
          {driverBookingRevenue.count > 0 ? (
            <View style={styles.driverRevenueBox}>
              <Text style={styles.driverRevenueBlockTitle}>Dinero según reservas</Text>
              <Text style={styles.driverRevenueTotal}>
                Total acordado: ₲ {driverBookingRevenue.totalGs.toLocaleString('es-PY')}
              </Text>
              <Text style={styles.driverRevenueMeta}>
                {driverBookingRevenue.count === 1 ? '1 reserva activa' : `${driverBookingRevenue.count} reservas activas`}
                {driverBookingRevenue.totalGs <= 0 ? ' · Monto en ₲0 (revisá datos de la reserva)' : ''}
              </Text>
              {driverBookingRevenue.totalGs > 0 && driverBookingRevenue.paidGs > 0 ? (
                <Text style={styles.driverRevenueMeta}>
                  Ya cobrado (confirmado en app): ₲ {driverBookingRevenue.paidGs.toLocaleString('es-PY')}
                  {driverBookingRevenue.pendingGs > 0
                    ? ` · Pendiente de cobrar: ₲ ${driverBookingRevenue.pendingGs.toLocaleString('es-PY')}`
                    : ''}
                </Text>
              ) : driverBookingRevenue.totalGs > 0 && driverBookingRevenue.pendingGs > 0 ? (
                <Text style={styles.driverRevenueMeta}>
                  Pendiente de cobrar (según reservas): ₲ {driverBookingRevenue.pendingGs.toLocaleString('es-PY')}
                </Text>
              ) : null}
            </View>
          ) : null}
          {priceSeat > 0 ? (
            <>
              <Text style={styles.sectionLabel}>Precio por asiento</Text>
              <Text style={styles.bodyLine}>{priceSeat.toLocaleString('es-PY')} PYG</Text>
            </>
          ) : null}
          {description ? (
            <>
              <Text style={styles.sectionLabel}>Descripción</Text>
              <Text style={styles.description}>{description}</Text>
            </>
          ) : null}
          {rideStops.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>Recorrido en orden del mapa</Text>
              {driverUiEnRoute ? null : (
                <Text style={styles.bodyMuted}>
                  Mismo orden que la ruta en el mapa. Amarillo: el próximo punto pendiente (“En camino”). Navegar y “Llegué”
                  usan ese mismo lugar (≤{ARRIVE_GATE_M} m).
                </Text>
              )}
              <TouchableOpacity
                style={styles.collapsibleHit}
                onPress={() => setMapRouteListExpanded((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={
                  mapRouteListExpanded
                    ? 'Ocultar lista orden del recorrido'
                    : `Ver lista del recorrido, ${mapVisitOrderRows.length} puntos`
                }
              >
                <Text style={styles.collapsibleHitText}>
                  {mapRouteListExpanded
                    ? 'Ocultar lista del recorrido'
                    : `Ver lista del recorrido (${mapVisitOrderRows.length} puntos)`}
                </Text>
              </TouchableOpacity>
              {mapRouteListExpanded
                ? mapVisitOrderRows.map((row, i) => {
                    const progress = mapVisitProgressList[i] ?? 'upcoming';
                    const kindLabel =
                      row.kind === 'published' ? 'Tu publicación' : row.kind === 'pickup' ? 'Subida' : 'Bajada';
                    return (
                      <View
                        key={`${row.kind}-${row.bookingId ?? ''}-${row.rideStopId ?? ''}-${i}`}
                        style={[
                          styles.stopRowWrap,
                          progress === 'done' && styles.stopRowWrapDone,
                          progress === 'current' && styles.stopRowWrapCurrent,
                        ]}
                      >
                        <View style={styles.stopRow}>
                          <Text style={styles.stopOrder}>{i + 1}.</Text>
                          <View style={styles.stopTextCol}>
                            <Text style={styles.stopKind}>{kindLabel}</Text>
                            <Text style={styles.stopLabel}>{row.title}</Text>
                            {row.subtitle ? (
                              <Text style={styles.stopSubtitle} numberOfLines={4}>
                                {row.subtitle}
                              </Text>
                            ) : null}
                          </View>
                          {progress === 'current' ? <Text style={styles.stopCurrentBadge}>En camino</Text> : null}
                        </View>
                      </View>
                    );
                  })
                : null}
            </>
          ) : null}
          {driverUiEnRoute && passengersOnBus.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>Pasajeros a bordo</Text>
              <Text style={styles.bodyMuted}>
                Marcá la bajada cuando quieras; no hace falta estar en el punto de bajada del mapa.
              </Text>
              <TouchableOpacity
                style={styles.collapsibleHit}
                onPress={() => setPassengersOnBusExpanded((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={
                  passengersOnBusExpanded
                    ? 'Ocultar pasajeros a bordo'
                    : `Ver pasajeros a bordo, ${passengersOnBus.length}`
                }
              >
                <Text style={styles.collapsibleHitText}>
                  {passengersOnBusExpanded
                    ? 'Ocultar pasajeros a bordo'
                    : `Ver pasajeros a bordo (${passengersOnBus.length})`}
                </Text>
              </TouchableOpacity>
              {passengersOnBusExpanded
                ? passengersOnBus.map((b) => {
                    const busy = manualDropoffBookingId === b.id;
                    return (
                      <View key={b.id} style={styles.stopRowWrap}>
                        <View style={styles.arriveRow}>
                          <ArrivePassengerRowHeader kind="dropoff" booking={b} ticketEmphasis />
                          <View style={styles.arriveActions}>
                            <TouchableOpacity
                              style={styles.arriveChip}
                              disabled={busy}
                              onPress={() => confirmManualDropoff(b)}
                            >
                              <Text style={styles.arriveChipText}>{busy ? 'Guardando…' : 'Bajó'}</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    );
                  })
                : null}
            </>
          ) : null}
          {isOwn && status === 'en_route' && hasActiveVisit && currentVisitRow ? (
            <>
              <Text style={styles.sectionLabel}>Navegación</Text>
              {awaitingStop ? (
                <Text style={styles.awaitingBanner}>
                  Opcional: registrá subidas o bajadas si corresponde. Confirmá para seguir el recorrido.
                </Text>
              ) : null}
              {!awaitingStop ? (
                <TouchableOpacity style={[styles.navBtn, styles.arriveBtn]} onPress={() => void openArriveModal()}>
                  <Text style={styles.navBtnText}>Llegué</Text>
                </TouchableOpacity>
              ) : null}
              {orderedNavigationTarget &&
              Number.isFinite(orderedNavigationTarget.lat) &&
              Number.isFinite(orderedNavigationTarget.lng) ? (
                <TouchableOpacity
                  style={styles.navBtn}
                  onPress={() => {
                    void openExternalNavigation(orderedNavigationTarget.lat, orderedNavigationTarget.lng);
                  }}
                  disabled={awaitingStop}
                >
                  <Text style={styles.navBtnText}>Navegar al punto actual</Text>
                </TouchableOpacity>
              ) : null}
            </>
          ) : null}
          {isOwn && status === 'en_route' && !hasActiveVisit && mapVisitOrderRows.length > 0 ? (
            <Text style={styles.navHintMuted}>
              Ya no quedan puntos pendientes en el recorrido. Usá “Finalizar viaje” cuando corresponda.
            </Text>
          ) : null}
        </>
      ) : (
        <>
          {!passengerBooking ? (
            <View style={[styles.statusPill, { borderColor: stCfg.color, marginBottom: 12 }]}>
              <View style={[styles.statusDot, { backgroundColor: stCfg.color }]} />
              <Text style={[styles.statusPillText, { color: stCfg.color }]}>
                Viaje: {stCfg.label}
                {status === 'en_route' ? ' · El conductor comparte ubicación en el mapa (punto azul).' : ''}
              </Text>
            </View>
          ) : null}
          {!passengerBooking && routeNameLine ? <Text style={styles.routeNameLine}>{routeNameLine}</Text> : null}
          {!passengerBooking ? (
            <Text style={styles.title}>
              {String(ride.origin_label ?? 'Origen')} → {String(ride.destination_label ?? 'Destino')}
            </Text>
          ) : null}
          <RideDetailRouteMap
            ride={ride}
            rideStops={rideStops}
            resolvedRoute={resolvedRideRoute}
            resolvedRouteLoading={resolvedRideRoute.loading}
            height={300}
            passengerBookingGeo={passengerMapGeo}
            coPassengerPickups={mapCoPassengerPickups}
            coPassengerDropoffs={mapCoPassengerDropoffs}
            driverLocation={driverLocationForMap}
          />
          {passengerBooking && passengerEtaToPickupMin != null ? (
            <Text style={styles.passengerEtaHint}>
              El conductor llega en aprox. {passengerEtaToPickupMin} min a tu punto de subida.
            </Text>
          ) : null}
          {passengerBooking ? (
            <View style={styles.bookingCard}>
              {formatBookingTicketCode(passengerBooking.booking_code) ? (
                <View style={styles.miTicketBox}>
                  <Text style={styles.miTicketLabel}>Mi ticket</Text>
                  <Text style={styles.miTicketCode}>
                    {formatBookingTicketCode(passengerBooking.booking_code)}
                  </Text>
                  <Text style={styles.miTicketAmount}>
                    Total a pagar: ₲ {passengerBooking.price_paid.toLocaleString('es-PY')}
                  </Text>
                  <Text style={styles.miTicketSeats}>
                    {formatSeatsLine(passengerBooking.seats_count)}
                  </Text>
                  <Text style={styles.miTicketHint}>
                    Mostrá este código al conductor al subir al minibús.
                  </Text>
                </View>
              ) : null}
              <Text style={styles.bookingCardTitle}>Tu reserva</Text>
              <Text style={styles.bookingMeta}>
                {bookingStatusLabel(passengerBooking.status)}
                {passengerBooking.payment_status
                  ? ` · Pago: ${passengerBooking.payment_status}`
                  : ''}
              </Text>
              {canPassengerShareSafetyTracking(
                passengerBooking,
                status,
                ride.share_code,
                boardingEvents
              ) ? (
                <>
                  <TouchableOpacity
                    style={styles.shareSafetyBtn}
                    onPress={() => void handleSharePassengerSafetyTracking()}
                    accessibilityRole="button"
                    accessibilityLabel="Compartir enlace de seguimiento del viaje"
                  >
                    <Ionicons name="share-social-outline" size={20} color="appBrand.colors.primary" />
                    <Text style={styles.shareSafetyBtnText}>Compartir seguimiento</Text>
                  </TouchableOpacity>
                  <Text style={styles.shareSafetyHint}>
                    Enlace público de solo lectura con mapa y ubicación del conductor. Deja de actualizarse cuando bajes
                    del minibús. No incluye tu teléfono ni datos privados.
                  </Text>
                </>
              ) : String(status) === 'en_route' &&
                passengerBooking &&
                boardingEvents.some(
                  (e) =>
                    String(e.booking_id) === passengerBooking.id &&
                    String(e.event_type) === 'dropped_off'
                ) ? (
                <Text style={styles.shareSafetyHint}>
                  El seguimiento compartido ya no está disponible porque registraste la bajada del minibús.
                </Text>
              ) : null}
              <View style={styles.bookingSummaryRow}>
                <View style={styles.bookingSummaryCol}>
                  <Text style={styles.sectionLabel}>Asientos</Text>
                  <Text style={styles.bodyLine}>{passengerBooking.seats_count}</Text>
                </View>
                <View style={styles.bookingSummaryCol}>
                  <Text style={styles.sectionLabel}>Total</Text>
                  <Text style={styles.bodyLine}>{passengerBooking.price_paid.toLocaleString('es-PY')} PYG</Text>
                </View>
                <TouchableOpacity
                  style={styles.bookingChevronBtn}
                  onPress={() => setBookingDetailsExpanded((v) => !v)}
                  accessibilityRole="button"
                  accessibilityLabel={bookingDetailsExpanded ? 'Ocultar subida y bajada' : 'Ver subida y bajada'}
                >
                  <Ionicons
                    name={bookingDetailsExpanded ? 'chevron-up-outline' : 'chevron-down-outline'}
                    size={20}
                    color="appBrand.colors.primary"
                  />
                </TouchableOpacity>
              </View>
              {bookingDetailsExpanded ? (
                <>
                  <Text style={styles.sectionLabel}>Subida</Text>
                  <Text style={passengerBooking.pickup_label ? styles.bodyLine : styles.bodyMuted}>
                    {passengerBooking.pickup_label ?? 'Ubicación elegida en el mapa al reservar.'}
                  </Text>
                  <Text style={styles.sectionLabel}>Bajada</Text>
                  <Text style={passengerBooking.dropoff_label ? styles.bodyLine : styles.bodyMuted}>
                    {passengerBooking.dropoff_label ?? 'Ubicación elegida en el mapa al reservar.'}
                  </Text>
                </>
              ) : null}
              {canPassengerCancelReservation(passengerBooking.status, status) ? (
                <TouchableOpacity
                  style={[styles.cancelBookingBtn, cancellingBooking && styles.btnDisabled]}
                  onPress={handleCancelPassengerBooking}
                  disabled={cancellingBooking}
                  accessibilityRole="button"
                  accessibilityLabel="Cancelar reserva"
                >
                  <Text style={styles.cancelBookingBtnText}>
                    {cancellingBooking ? 'Cancelando…' : 'Cancelar reserva'}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
          {status !== 'en_route' ? (
            <>
              <Text style={styles.sectionLabel}>Salida</Text>
              <Text style={styles.bodyLine}>
                {formatRideDate(depIso)} · {formatRideTime(depIso)}
              </Text>
              <Text style={styles.bodyMuted}>
                {flexible ? 'Ventana ±30 min alrededor de la hora' : 'Salida a horario acordado (±5 min)'}
              </Text>
            </>
          ) : null}
          <Text style={styles.sectionLabel}>Cupos</Text>
          <Text style={styles.bodyLine}>
            {available} disponibles
            {totalSeats > 0 ? ` de ${totalSeats}` : ''}
          </Text>
          {priceSeat > 0 ? (
            <>
              <Text style={styles.sectionLabel}>Precio por asiento</Text>
              <Text style={styles.bodyLine}>{priceSeat.toLocaleString('es-PY')} PYG</Text>
            </>
          ) : null}
          {vehicleLine ? (
            <>
              <Text style={styles.sectionLabel}>Vehículo</Text>
              <Text style={styles.bodyLine}>{vehicleLine}</Text>
            </>
          ) : null}
          {driver?.vehicle_photo_url ? (
            <Image
              source={{ uri: String(driver.vehicle_photo_url) }}
              style={styles.vehiclePhoto}
              resizeMode="cover"
            />
          ) : null}
          {description ? (
            <>
              <Text style={styles.sectionLabel}>Descripción</Text>
              <Text style={styles.description}>{description}</Text>
            </>
          ) : null}
          {driver ? (
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Conductor</Text>
              {driver.avatar_url ? (
                <Image source={{ uri: String(driver.avatar_url) }} style={styles.driverAvatar} resizeMode="cover" />
              ) : null}
              <Text style={styles.cardValue}>{driver.full_name ?? '—'}</Text>
              {driverRatingLabel ? (
                <Text style={styles.meta}>
                  ★ {driverRatingLabel}
                  {driver.rating_count && driver.rating_count > 0
                    ? ` · ${driver.rating_count} calificación${driver.rating_count !== 1 ? 'es' : ''}`
                    : ''}
                </Text>
              ) : null}
              {passengerDriverContactInCard.show ? (
                <View style={styles.driverCardContactWrap}>
                  <TouchableOpacity
                    style={[
                      styles.contactBtnInCard,
                      (!passengerDriverContactInCard.enabled || contactingDriver) && styles.contactBtnInCardDisabled,
                    ]}
                    onPress={() => void handleContactDriver()}
                    disabled={!passengerDriverContactInCard.enabled || contactingDriver}
                    accessibilityRole="button"
                    accessibilityState={{
                      disabled: !passengerDriverContactInCard.enabled || contactingDriver,
                    }}
                    accessibilityLabel={
                      passengerDriverContactInCard.enabled
                        ? 'Contactar conductor'
                        : 'Contactar conductor, disponible 20 minutos antes del viaje'
                    }
                  >
                    <Text
                      style={[
                        styles.contactBtnInCardText,
                        (!passengerDriverContactInCard.enabled || contactingDriver) &&
                          styles.contactBtnInCardTextDisabled,
                      ]}
                    >
                      {contactingDriver ? 'Abriendo chat…' : 'Mensaje al conductor'}
                    </Text>
                  </TouchableOpacity>
                  {!passengerDriverContactInCard.enabled ? (
                    <Text style={styles.contactBtnHint}>{passengerDriverContactInCard.hintDisabled}</Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}
        </>
      )}

      {!isOwn && available > 0 && session?.id && !passengerBooking ? (
        <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.navigate('BookRide', { rideId })}>
          <Text style={styles.primaryBtnText}>Reservar asiento</Text>
        </TouchableOpacity>
      ) : null}
      {!isOwn && available < 1 && !passengerBooking ? (
        <Text style={styles.muted}>Sin cupos disponibles.</Text>
      ) : null}

      {isOwn ? (
        <View style={styles.actions}>
          {canStart ? (
            <TouchableOpacity
              style={[styles.primaryBtn, statusUpdating && styles.btnDisabled]}
              disabled={statusUpdating}
              onPress={() => runStatusUpdate('en_route')}
            >
              <Text style={styles.primaryBtnText}>{statusUpdating ? 'Procesando…' : 'Iniciar viaje'}</Text>
            </TouchableOpacity>
          ) : null}
          {canComplete ? (
            <TouchableOpacity
              style={[styles.completeBtn, statusUpdating && styles.btnDisabled]}
              disabled={statusUpdating}
              onPress={() => runStatusUpdate('completed')}
            >
              <Text style={styles.primaryBtnText}>{statusUpdating ? 'Procesando…' : 'Finalizar viaje'}</Text>
            </TouchableOpacity>
          ) : null}
          {canCancel ? (
            <TouchableOpacity
              style={[styles.cancelDriverRideBtn, statusUpdating && styles.btnDisabled]}
              disabled={statusUpdating}
              onPress={() => runStatusUpdate('cancelled')}
            >
              <Text style={styles.primaryBtnText}>{statusUpdating ? 'Procesando…' : 'Cancelar viaje'}</Text>
            </TouchableOpacity>
          ) : null}
          {status === 'en_route' ? (
            <Text style={styles.hint}>
              “Llegué” (≤{ARRIVE_GATE_M} m del punto): subida/bajada del pasajero, cobro al subir, y opciones a{' '}
              {ARRIVE_NEAR_BUS_M} m del minibús.
            </Text>
          ) : null}
          {isOwn && status === 'en_route' && !canComplete ? (
            <Text style={styles.hint}>
              “Finalizar viaje” se habilita cuando confirmes el último punto del recorrido (subidas, bajadas o destino).
            </Text>
          ) : null}
          {canEdit ? (
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => navigation.navigate('EditRide', { rideId })}>
              <Text style={styles.secondaryText}>Editar viaje</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <TouchableOpacity style={styles.secondaryBtn} onPress={() => navigation.goBack()}>
        <Text style={styles.secondaryText}>Volver</Text>
      </TouchableOpacity>
    </ScrollView>

      <Modal visible={arriveModalOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.arriveCard}>
            <Text style={styles.arriveTitle}>
              Llegada · {currentVisitRow?.title?.trim() || 'Punto del recorrido'}
            </Text>
            {currentVisitRow?.subtitle ? (
              <Text style={styles.arriveSubtitle}>{currentVisitRow.subtitle}</Text>
            ) : null}
            <ScrollView style={styles.arriveBody}>
              {arriveModalHasPassengers ? (
                <Text style={styles.arriveSectionHint}>
                  Quienes aparecen acá están cerca del punto o del minibús. Marcar subida/bajada es opcional.
                </Text>
              ) : null}
              {(primaryArrivePickups.length > 0 || primaryArriveDropoffs.length > 0) && (
                <Text style={styles.arriveSectionLabel}>Este punto (opcional)</Text>
              )}
              {primaryArrivePickups.map((b) => (
                <View key={`p:${b.id}`} style={styles.arriveRow}>
                  <ArrivePassengerRowHeader kind="pickup" booking={b} showAmount ticketEmphasis />
                  <View style={styles.arriveActions}>
                    <TouchableOpacity
                      style={[
                        styles.arriveChip,
                        arriveDecisions[`pickup:${b.id}`] === 'boarded' && styles.arriveChipActiveOk,
                      ]}
                      onPress={() =>
                        setArriveDecisions((prev) => ({ ...prev, [`pickup:${b.id}`]: 'boarded' }))
                      }
                    >
                      <Text style={styles.arriveChipText}>Subió + cobrar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.arriveChip,
                        arriveDecisions[`pickup:${b.id}`] === 'no_show' && styles.arriveChipActiveNo,
                      ]}
                      onPress={() =>
                        setArriveDecisions((prev) => ({ ...prev, [`pickup:${b.id}`]: 'no_show' }))
                      }
                    >
                      <Text style={styles.arriveChipText}>No subió</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
              {primaryArriveDropoffs.map((b) => (
                <View key={`d:${b.id}`} style={styles.arriveRow}>
                  <ArrivePassengerRowHeader kind="dropoff" booking={b} ticketEmphasis />
                  <View style={styles.arriveActions}>
                    <TouchableOpacity
                      style={[
                        styles.arriveChip,
                        arriveDecisions[`dropoff:${b.id}`] === 'dropped_off' && styles.arriveChipActiveWarn,
                      ]}
                      onPress={() =>
                        setArriveDecisions((prev) => ({ ...prev, [`dropoff:${b.id}`]: 'dropped_off' }))
                      }
                    >
                      <Text style={styles.arriveChipText}>Bajó</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}

              <TouchableOpacity
                style={styles.arriveExpandHit}
                onPress={() => setArriveExtraExpanded((v) => !v)}
              >
                <Text style={styles.arriveExpandText}>
                  {arriveExtraExpanded ? '▼' : '▶'} Subió cerca del minibús (opcional, ≤{ARRIVE_NEAR_BUS_M} m)
                  {extraArrivePickups.length > 0 ? ` · ${extraArrivePickups.length}` : ''}
                </Text>
              </TouchableOpacity>
              {arriveExtraExpanded
                ? extraArrivePickups.map((b) => (
                    <View key={`x:${b.id}`} style={styles.arriveRowIndented}>
                      <ArrivePassengerRowHeader kind="pickup" booking={b} showAmount ticketEmphasis />
                      <View style={styles.arriveActions}>
                        <TouchableOpacity
                          style={[
                            styles.arriveChip,
                            arriveDecisions[`pickup:${b.id}`] === 'boarded' && styles.arriveChipActiveOk,
                          ]}
                          onPress={() =>
                            setArriveDecisions((prev) => ({ ...prev, [`pickup:${b.id}`]: 'boarded' }))
                          }
                        >
                          <Text style={styles.arriveChipText}>Subió + cobrar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[
                            styles.arriveChip,
                            arriveDecisions[`pickup:${b.id}`] === 'no_show' && styles.arriveChipActiveNo,
                          ]}
                          onPress={() =>
                            setArriveDecisions((prev) => ({ ...prev, [`pickup:${b.id}`]: 'no_show' }))
                          }
                        >
                          <Text style={styles.arriveChipText}>No subió</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))
                : null}

              {(dropoffArriveList.length > 0 || primaryArriveDropoffs.length > 0) && (
                <TouchableOpacity
                  style={styles.arriveExpandHit}
                  onPress={() => setArriveDropExpanded((v) => !v)}
                >
                  <Text style={styles.arriveExpandText}>
                    {arriveDropExpanded ? '▼' : '▶'} Bajar en el recorrido (opcional)
                    {dropoffArriveList.length > 0 ? ` · ${dropoffArriveList.length}` : ''}
                  </Text>
                </TouchableOpacity>
              )}
              {arriveDropExpanded
                ? dropoffArriveList.map((b) => (
                    <View key={`dr:${b.id}`} style={styles.arriveRowIndented}>
                      <ArrivePassengerRowHeader kind="dropoff" booking={b} ticketEmphasis />
                      <View style={styles.arriveActions}>
                        <TouchableOpacity
                          style={[
                            styles.arriveChip,
                            arriveDecisions[`dropoff:${b.id}`] === 'dropped_off' && styles.arriveChipActiveWarn,
                          ]}
                          onPress={() =>
                            setArriveDecisions((prev) => ({ ...prev, [`dropoff:${b.id}`]: 'dropped_off' }))
                          }
                        >
                          <Text style={styles.arriveChipText}>Bajó</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))
                : null}
            </ScrollView>
            <View style={styles.arriveFooter}>
              <TouchableOpacity
                style={styles.arriveCancel}
                onPress={() => {
                  setArriveModalOpen(false);
                  void setRideAwaitingStopConfirmation(rideId, false);
                }}
              >
                <Text style={styles.arriveCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.arriveConfirm, submittingArrive && styles.btnDisabled]}
                disabled={submittingArrive}
                onPress={() => void submitArriveModal()}
              >
                <Text style={styles.arriveConfirmText}>
                  {submittingArrive ? 'Guardando…' : arriveModalHasPassengers ? 'Confirmar y seguir' : 'Continuar viaje'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={ratePassengerModalOpen && passengerToRate != null} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.arriveCard}>
            <Text style={styles.arriveTitle}>Calificar pasajero</Text>
            <Text style={styles.arriveSubtitle}>
              ¿Cómo fue tu experiencia con {passengerToRate?.displayName ?? 'el pasajero'}? Por defecto 5
              estrellas. El promedio público se recalcula al llegar a {PROFILE_RATING_WINDOW} calificaciones.
            </Text>
            <View style={styles.rateStarsRow}>
              {[1, 2, 3, 4, 5].map((n) => (
                <TouchableOpacity
                  key={n}
                  style={[styles.rateStarBtn, ratePassengerStars >= n && styles.rateStarBtnActive]}
                  onPress={() => setRatePassengerStars(n)}
                  accessibilityRole="button"
                  accessibilityLabel={`${n} estrella${n !== 1 ? 's' : ''}`}
                >
                  <Text style={[styles.rateStarText, ratePassengerStars >= n && styles.rateStarTextActive]}>★</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.arriveFooter}>
              <TouchableOpacity
                style={styles.arriveCancel}
                onPress={() => {
                  if (passengerToRate) {
                    setPassengerRatingsGiven((prev) => new Set(prev).add(passengerToRate.passengerId));
                  }
                  setRatePassengerModalOpen(false);
                  setPassengerToRate(null);
                }}
              >
                <Text style={styles.arriveCancelText}>Omitir</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.arriveConfirm,
                  (ratePassengerStars < 1 || submittingPassengerRating) && styles.btnDisabled,
                ]}
                disabled={ratePassengerStars < 1 || submittingPassengerRating}
                onPress={() => void submitRatePassenger()}
              >
                <Text style={styles.arriveConfirmText}>
                  {submittingPassengerRating ? 'Enviando…' : 'Enviar'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={statusUpdating} transparent animationType="fade">
        <View style={styles.modalOverlay} pointerEvents="box-none">
          <View style={styles.modalCard}>
            <ActivityIndicator size="large" color="appBrand.colors.primary" />
            <Text style={styles.modalText}>Actualizando el viaje…</Text>
            <Text style={styles.modalSub}>Puede tardar unos segundos la primera vez.</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flexFill: { flex: 1, backgroundColor: '#fff' },
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, paddingBottom: 32 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  statusPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 16,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusPillText: { fontSize: 13, fontWeight: '700' },
  sectionLabel: {
    fontSize: 11,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 14,
    marginBottom: 4,
  },
  routeNameLine: { fontSize: 15, fontWeight: '700', color: appBrand.colors.primary, marginBottom: 6 },
  title: { fontSize: 18, fontWeight: '700', color: '#111', lineHeight: 24 },
  bodyLine: { fontSize: 15, color: '#111', fontWeight: '500' },
  bodyMuted: { fontSize: 13, color: '#6b7280', marginTop: 4, lineHeight: 18 },
  driverRevenueBox: {
    marginTop: 10,
    padding: 12,
    backgroundColor: appBrand.colors.greenLight,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: appBrand.colors.greenLight,
  },
  driverRevenueBlockTitle: {
    fontSize: 11,
    color: appBrand.colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontWeight: '700',
  },
  driverRevenueTotal: {
    fontSize: 17,
    fontWeight: '800',
    color: appBrand.colors.primary,
    marginTop: 2,
  },
  driverRevenueMeta: {
    fontSize: 13,
    color: '#3f6212',
    marginTop: 6,
    lineHeight: 18,
  },
  navHintMuted: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 10,
    lineHeight: 17,
  },
  description: { fontSize: 14, color: '#374151', lineHeight: 20 },
  stopRowWrap: {
    marginTop: 8,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  stopRowWrapDone: {
    backgroundColor: appBrand.colors.greenLight,
    borderColor: '#a7f3d0',
  },
  stopRowWrapCurrent: {
    backgroundColor: '#fffbeb',
    borderColor: '#fcd34d',
  },
  stopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  stopOrder: { fontSize: 14, fontWeight: '700', color: appBrand.colors.primary, width: 22 },
  stopTextCol: { flex: 1, minWidth: 0 },
  stopKind: { fontSize: 11, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 },
  stopLabel: { fontSize: 14, color: '#374151', lineHeight: 20 },
  stopLabelFlex: { flex: 1 },
  stopSubtitle: { fontSize: 12, color: '#6b7280', marginTop: 4, lineHeight: 16 },
  collapsibleHit: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  collapsibleHitText: { fontSize: 13, fontWeight: '700', color: '#374151', textAlign: 'center' },
  collapsibleBox: { marginTop: 8, paddingLeft: 4 },
  stopCurrentBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1d4ed8',
    backgroundColor: '#dbeafe',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  awaitingBanner: {
    fontSize: 13,
    color: '#92400e',
    backgroundColor: '#fffbeb',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#fcd34d',
    marginBottom: 10,
    lineHeight: 18,
  },
  navBtn: {
    backgroundColor: '#1d4ed8',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  arriveBtn: {
    backgroundColor: '#b45309',
  },
  navBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  arriveCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    maxWidth: 420,
    width: '100%',
    maxHeight: '85%',
    overflow: 'hidden',
  },
  arriveTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#111827',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
    borderBottomWidth: 0,
  },
  arriveSubtitle: {
    fontSize: 13,
    color: '#6b7280',
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderColor: '#e5e7eb',
  },
  arriveSectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: appBrand.colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
    marginBottom: 8,
  },
  arriveSectionHint: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 10,
    lineHeight: 18,
  },
  arriveExpandHit: {
    marginTop: 12,
    marginBottom: 6,
    paddingVertical: 8,
  },
  arriveExpandText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#374151',
  },
  arriveRowIndented: {
    paddingVertical: 10,
    paddingLeft: 10,
    marginBottom: 4,
    borderLeftWidth: 3,
    borderLeftColor: '#d1d5db',
  },
  arriveBody: {
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  arriveRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: '#f3f4f6',
  },
  arriveLabel: {
    fontSize: 14,
    color: '#374151',
    fontWeight: '600',
  },
  arriveTicketHero: {
    fontSize: 26,
    fontWeight: '800',
    color: appBrand.colors.primary,
    letterSpacing: 2,
    marginBottom: 4,
  },
  arriveTicketCode: {
    fontSize: 22,
    fontWeight: '800',
    color: appBrand.colors.primary,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  arriveTicketMissing: {
    fontSize: 14,
    fontWeight: '700',
    color: '#b91c1c',
    marginBottom: 4,
  },
  arrivePlaceMuted: {
    fontSize: 12,
    color: '#6b7280',
    lineHeight: 17,
    marginBottom: 2,
  },
  arriveSeatsLine: {
    fontSize: 14,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 4,
  },
  arriveAmount: {
    marginTop: 5,
    fontSize: 13,
    color: appBrand.colors.primary,
    fontWeight: '700',
  },
  arriveActions: {
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  arriveChip: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#fff',
  },
  arriveChipActiveOk: {
    backgroundColor: appBrand.colors.primary,
    borderColor: appBrand.colors.primary,
  },
  arriveChipActiveNo: {
    backgroundColor: '#b91c1c',
    borderColor: '#b91c1c',
  },
  arriveChipActiveWarn: {
    backgroundColor: '#b45309',
    borderColor: '#b45309',
  },
  arriveChipText: {
    fontSize: 13,
    color: '#111827',
    fontWeight: '700',
  },
  arriveFooter: {
    padding: 12,
    borderTopWidth: 1,
    borderColor: '#e5e7eb',
    flexDirection: 'row',
    gap: 10,
  },
  arriveCancel: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  arriveCancelText: {
    color: '#374151',
    fontWeight: '700',
  },
  arriveConfirm: {
    flex: 1,
    backgroundColor: appBrand.colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  arriveConfirmText: {
    color: '#fff',
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 32,
    alignItems: 'center',
    maxWidth: 320,
    width: '100%',
  },
  modalText: { marginTop: 16, fontSize: 16, fontWeight: '700', color: '#111', textAlign: 'center' },
  modalSub: { marginTop: 8, fontSize: 13, color: '#6b7280', textAlign: 'center' },
  meta: { fontSize: 14, color: '#6b7280', marginTop: 6 },
  card: { backgroundColor: '#f9fafb', padding: 14, borderRadius: 10, marginTop: 16 },
  driverAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: '#d1d5db',
    marginBottom: 10,
    backgroundColor: '#fff',
  },
  vehiclePhoto: {
    width: '100%',
    height: 170,
    borderRadius: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  miTicketBox: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: appBrand.colors.primary,
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    alignItems: 'center',
  },
  miTicketLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: appBrand.colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  miTicketCode: {
    fontSize: 32,
    fontWeight: '800',
    color: appBrand.colors.primary,
    letterSpacing: 2,
  },
  miTicketAmount: {
    fontSize: 17,
    fontWeight: '700',
    color: appBrand.colors.primary,
    marginTop: 10,
  },
  miTicketSeats: {
    fontSize: 16,
    fontWeight: '700',
    color: '#374151',
    marginTop: 6,
  },
  miTicketHint: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 17,
  },
  bookingCard: {
    backgroundColor: appBrand.colors.greenLight,
    borderWidth: 1,
    borderColor: '#a7f3d0',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  bookingCardTitle: { fontSize: 17, fontWeight: '800', color: appBrand.colors.primary, marginBottom: 6 },
  bookingMeta: { fontSize: 13, color: appBrand.colors.primary, marginBottom: 8, fontWeight: '600' },
  bookingSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  bookingSummaryCol: { flex: 1, minWidth: 0 },
  etaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 18 },
  etaCol: { minWidth: 110 },
  etaSubLabel: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  bookingChevronBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#93c5fd',
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  passengerEtaHint: {
    fontSize: 13,
    color: appBrand.colors.primary,
    backgroundColor: appBrand.colors.greenLight,
    borderWidth: 1,
    borderColor: '#86efac',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginTop: 8,
    marginBottom: 10,
    fontWeight: '600',
  },
  cancelBookingBtn: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#b91c1c',
    alignItems: 'center',
  },
  cancelBookingBtnText: { color: '#b91c1c', fontWeight: '700', fontSize: 15 },
  rateStarsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginVertical: 16,
  },
  rateStarBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rateStarBtnActive: { backgroundColor: '#f59e0b' },
  rateStarText: { fontSize: 22, color: '#6b7280' },
  rateStarTextActive: { color: '#fff' },
  shareSafetyBtn: {
    marginTop: 4,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: appBrand.colors.primaryMuted,
    backgroundColor: '#fff',
  },
  shareSafetyBtnText: { color: appBrand.colors.primary, fontWeight: '700', fontSize: 15 },
  shareSafetyHint: { fontSize: 12, color: appBrand.colors.primary, lineHeight: 17, marginBottom: 6, fontWeight: '500' },
  driverCardContactWrap: { marginTop: 14, width: '100%' },
  contactBtnInCard: {
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#2563eb',
    alignItems: 'center',
  },
  contactBtnInCardDisabled: {
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  contactBtnInCardText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  contactBtnInCardTextDisabled: { color: '#9ca3af', fontWeight: '600' },
  contactBtnHint: {
    marginTop: 8,
    fontSize: 12,
    color: '#9ca3af',
    lineHeight: 17,
    textAlign: 'center',
  },
  cardLabel: { fontSize: 12, color: '#6b7280', textTransform: 'uppercase' },
  cardValue: { fontSize: 17, fontWeight: '600', marginTop: 4 },
  actions: { marginTop: 24, gap: 0 },
  primaryBtn: {
    backgroundColor: appBrand.colors.primary,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  completeBtn: {
    backgroundColor: appBrand.colors.primaryMuted,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  cancelDriverRideBtn: {
    backgroundColor: '#b91c1c',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  btnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondaryBtn: { marginTop: 14, alignItems: 'center', paddingVertical: 10 },
  secondaryText: { color: appBrand.colors.primary, fontWeight: '600', fontSize: 15 },
  hint: { fontSize: 13, color: '#6b7280', marginTop: 12, lineHeight: 18 },
  muted: { marginTop: 16, color: '#6b7280' },
  errorText: { color: '#b91c1c', textAlign: 'center', marginBottom: 12 },
  btn: { backgroundColor: appBrand.colors.primary, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8 },
  btnText: { color: '#fff', fontWeight: '700' },
});
