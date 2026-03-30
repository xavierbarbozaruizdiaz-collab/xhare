/**
 * Detalle de viaje: pasajero ve conductor y puede reservar; conductor ve resumen tipo publicación e Iniciar/Finalizar viaje.
 */
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
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
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
import { RideDetailRouteMap, type PassengerBookingMapGeo } from '../components/RideDetailRouteMap';
import { distanceMeters, type Point } from '../lib/geo';
import { sendRideLocation } from '../backend/locationApi';
import { confirmRideBookingPayment, arriveAtStop, setRideAwaitingStopConfirmation } from '../backend/api';
import { requestLocationPermission } from '../permissions';
import { getOriginForExternalNavigation } from '../location/getOriginForExternalNavigation';

type Nav = NativeStackNavigationProp<MainStackParamList, 'RideDetail'>;
type ScreenRoute = RouteProp<MainStackParamList, 'RideDetail'>;

/** No duplicar en el mapa el pin “otro pasajero” si coincide con tu subida/bajada/paradas extra. */
const CO_PASSENGER_DEDUP_M = 35;

type PassengerBookingSummary = {
  id: string;
  status: string;
  seats_count: number;
  price_paid: number;
  pickup_label: string | null;
  dropoff_label: string | null;
  payment_status: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
};

type DriverBookingStop = {
  id: string;
  passenger_id: string;
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

function bookingDropoffNearPublishedStop(b: DriverBookingStop, stop: RideStopForReserve | undefined): boolean {
  if (!stop || b.status === 'cancelled') return false;
  if (b.dropoff_stop_id != null && b.dropoff_stop_id === stop.id) return true;
  if (b.dropoff_stop_id != null) return false;
  const p = bookingDropoffPoint(b);
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

function mapVisitRowIsCurrent(
  row: OrderedMapVisitRow,
  currentNavStop: RideStopForReserve | undefined,
  bookings: DriverBookingStop[]
): boolean {
  if (!currentNavStop) return false;
  if (row.kind === 'published' && row.rideStopId === currentNavStop.id) return true;
  if (!row.bookingId) return false;
  const b = bookings.find((x) => x.id === row.bookingId);
  if (!b) return false;
  if (row.kind === 'pickup') return bookingPickupNearPublishedStop(b, currentNavStop);
  if (row.kind === 'dropoff') return bookingDropoffNearPublishedStop(b, currentNavStop);
  return false;
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
        (e.event_type === 'boarded' || e.event_type === 'no_show')
    );
  }
  if (row.kind === 'dropoff' && row.bookingId) {
    return boardingEvents.some(
      (e) => String(e.booking_id) === row.bookingId && e.event_type === 'dropped_off'
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

/**
 * Progreso por fila alineado al orden del mapa/OSRM: como mucho una fila “En camino” (la primera en la lista que
 * coincide con la parada publicada actual del viaje).
 */
function resolveMapVisitProgressList(
  rows: OrderedMapVisitRow[],
  ctx: {
    status: string;
    currentNavStop: RideStopForReserve | undefined;
    driverRideBookings: DriverBookingStop[];
    boardingEvents: BoardingEventRow[];
    rideStopsSorted: RideStopForReserve[];
  }
): MapVisitProgress[] {
  const { status, currentNavStop, driverRideBookings, boardingEvents, rideStopsSorted } = ctx;
  const doneFlags = rows.map((row) => visitRowIsDone(row, boardingEvents, rideStopsSorted));
  if (status !== 'en_route') {
    return doneFlags.map((d) => (d ? 'done' : 'upcoming'));
  }
  const canCurrent = rows.map(
    (row, i) =>
      !doneFlags[i] && mapVisitRowIsCurrent(row, currentNavStop, driverRideBookings)
  );
  let win = -1;
  for (let i = 0; i < rows.length; i++) {
    if (canCurrent[i]) {
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

/** Destino de navegación para una fila del recorrido ordenado (misma geometría que la lista / OSRM). */
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

/** Lista colapsable “paradas que cargué al publicar”: mismo criterio que la fila published del recorrido en mapa. */
function publishedStopRowProgress(
  stop: RideStopForReserve | undefined,
  status: string,
  hasValidCurrentStop: boolean,
  stopIdxForActualBadge: number,
  rowIndex: number
): MapVisitProgress {
  const arrived = stop?.arrived_at != null && String(stop.arrived_at).length > 0;
  if (arrived) return 'done';
  if (status === 'en_route' && hasValidCurrentStop && rowIndex === stopIdxForActualBadge) return 'current';
  return 'upcoming';
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

function friendlyStatusError(code: string | undefined, details?: string): string {
  switch (code) {
    case 'already_has_active_ride':
      return 'Ya tenés un viaje en curso. Finalizá ese antes de iniciar otro.';
    case 'account_suspended':
      return 'Tu cuenta está suspendida. No podés iniciar ni finalizar viajes hasta regularizar.';
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
  const { rideId } = route.params;

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
  const [arriveModalOpen, setArriveModalOpen] = useState(false);
  const [arriveDecisions, setArriveDecisions] = useState<Record<string, 'boarded' | 'no_show' | 'dropped_off'>>({});
  const [arrivePaymentConfirmed, setArrivePaymentConfirmed] = useState<Record<string, boolean>>({});
  const [submittingArrive, setSubmittingArrive] = useState(false);
  /** Lista orden mapa (muchos ítems): colapsada por defecto. */
  const [mapRouteListExpanded, setMapRouteListExpanded] = useState(false);
  /** Lista “paradas publicadas”; el conductor la abre solo si la necesita. */
  const [driverPublishedStopsExpanded, setDriverPublishedStopsExpanded] = useState(false);
  const [boardingEvents, setBoardingEvents] = useState<BoardingEventRow[]>([]);
  /** Evita re-render del mapa si el poll silencioso no cambió datos visibles (menos parpadeo / menos OSRM). */
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
        'id, status, seats_count, price_paid, pickup_label, dropoff_label, payment_status, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng'
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
      status: String(data.status ?? ''),
      seats_count: Math.max(1, Number(data.seats_count ?? 1)),
      price_paid: Number(data.price_paid ?? 0),
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

  const refetchDriverBookingPins = useCallback(async () => {
    if (!session?.id || !ride || String(ride.driver_id) !== String(session.id)) {
      setDriverBookingPins([]);
      setDriverRideBookings([]);
      setBoardingEvents([]);
      return;
    }
    const { data, error } = await supabase
      .from('bookings')
      .select(
        'id, passenger_id, status, pickup_stop_id, dropoff_stop_id, pickup_label, dropoff_label, price_paid, payment_status, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng'
      )
      .eq('ride_id', rideId)
      .neq('status', 'cancelled');
    if (error) return;
    setDriverRideBookings(
      (data ?? []).map((row: Record<string, unknown>) => ({
        id: String(row.id ?? ''),
        passenger_id: String(row.passenger_id ?? ''),
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
      const { data: ev, error: evErr } = await supabase
        .from('ride_boarding_events')
        .select('booking_id, stop_index, event_type')
        .eq('ride_id', rideId);
      if (!evErr) setBoardingEvents((ev ?? []) as BoardingEventRow[]);
    } else {
      setBoardingEvents([]);
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

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
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
        return;
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
        return;
      }
      rideVisualSigRef.current = sig;
      setRide(nextRide);
      setRideStops(stops);
    } catch (e) {
      if (!quiet) setError(e instanceof Error ? e.message : 'Error al cargar');
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
    void refetchCoPassengerMapPoints();
  }, [refetchCoPassengerMapPoints]);

  useFocusEffect(
    useCallback(() => {
      void load({ quiet: true });
      void loadPassengerBooking();
      void refetchDriverBookingPins();
      void refetchCoPassengerMapPoints();
    }, [load, loadPassengerBooking, refetchDriverBookingPins, refetchCoPassengerMapPoints])
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

  /** Conductor en_route: ubicación + datos. Pasajero con reserva: ver cuando el viaje pasa a en_route y el pin del conductor (sin depender de salir de la pantalla). */
  useEffect(() => {
    if (!ride) return;
    const st = String(ride.status ?? '');
    const isDriver = Boolean(session?.id && String(ride.driver_id) === String(session.id));
    const isPassengerWithBooking = Boolean(
      session?.id && passengerBooking && String(ride.driver_id) !== String(session.id)
    );
    const driverNeedsTick = isDriver && st === 'en_route';
    const passengerNeedsTick =
      isPassengerWithBooking && st !== 'completed' && st !== 'cancelled';
    if (!driverNeedsTick && !passengerNeedsTick) return;

    const t = setInterval(() => {
      void load({ quiet: true });
      void loadPassengerBooking();
      if (isDriver) void refetchDriverBookingPins();
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
  ]);

  useEffect(() => {
    if (!ride || !session?.id) return;
    if (String(ride.driver_id) !== String(session.id)) return;
    if (String(ride.status ?? '') !== 'en_route') return;
    let cancelled = false;
    const send = async () => {
      const granted = await requestLocationPermission();
      if (!granted || cancelled) return;
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }).catch(() => null);
      if (!pos || cancelled) return;
      const { data: auth } = await supabase.auth.getSession();
      const token = auth.session?.access_token;
      if (!token || cancelled) return;
      await sendRideLocation(rideId, pos.coords.latitude, pos.coords.longitude, token).catch(() => false);
    };
    void send();
    const t = setInterval(() => {
      void send();
    }, 25_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [ride, rideId, session?.id]);

  const runStatusUpdate = useCallback(
    (next: 'en_route' | 'completed') => {
      const title = next === 'en_route' ? 'Iniciar viaje' : 'Finalizar viaje';
      const message =
        next === 'en_route'
          ? 'Los pasajeros verán el viaje como en camino. ¿Confirmás?'
          : '¿Marcar el viaje como completado?';
      Alert.alert(title, message, [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: next === 'en_route' ? 'Iniciar' : 'Finalizar',
          style: next === 'completed' ? 'destructive' : 'default',
          onPress: () => {
            void (async () => {
              const { data: auth } = await supabase.auth.getSession();
              const token = auth.session?.access_token;
              if (!token) {
                Alert.alert('Sesión', 'Volvé a iniciar sesión.');
                return;
              }
              setStatusUpdating(true);
              try {
                const r = await updateRideStatus(rideId, next, token);
                if (!r.ok) {
                  Alert.alert('No se pudo actualizar', friendlyStatusError(r.error, r.details));
                  return;
                }
                await load({ quiet: true });
                if (next === 'en_route') {
                  Alert.alert('Listo', 'El viaje quedó en curso.');
                } else {
                  Alert.alert('Listo', 'Viaje finalizado.');
                }
              } finally {
                setStatusUpdating(false);
              }
            })();
          },
        },
      ]);
    },
    [rideId, load]
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
      return [...rideStops]
        .sort((a, b) => a.stop_order - b.stop_order)
        .map((s) => ({
          kind: 'published' as const,
          lat: s.lat,
          lng: s.lng,
          title: s.label?.trim() || 'Parada del recorrido publicado',
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
    const rawIdx = Number(ride.current_stop_index ?? 0);
    const len = rideStops.length;
    const hasCur = len > 0 && Number.isFinite(rawIdx) && rawIdx >= 0 && rawIdx < len;
    const currentNav = hasCur ? rideStops[rawIdx] : undefined;
    return resolveMapVisitProgressList(mapVisitOrderRows, {
      status: st,
      currentNavStop: currentNav,
      driverRideBookings,
      boardingEvents,
      rideStopsSorted: rideStops,
    });
  }, [
    ride,
    rideStops,
    mapVisitOrderRows,
    driverRideBookings,
    boardingEvents,
  ]);

  const orderedNavigationTarget = useMemo((): Point | null => {
    if (!ride || String(ride.status ?? '') !== 'en_route') return null;
    const rawIdx = Number(ride.current_stop_index ?? 0);
    const len = rideStops.length;
    const hasCur = len > 0 && Number.isFinite(rawIdx) && rawIdx >= 0 && rawIdx < len;
    const currentNav = hasCur ? rideStops[rawIdx] : undefined;
    if (!hasCur || !currentNav) return null;
    const curIdx = mapVisitProgressList.findIndex((p) => p === 'current');
    if (curIdx >= 0 && mapVisitOrderRows[curIdx]) {
      const t = navTargetForMapVisitRow(mapVisitOrderRows[curIdx], rideStops, driverRideBookings);
      if (t && Number.isFinite(t.lat) && Number.isFinite(t.lng)) return t;
    }
    return externalNavTargetForStop(currentNav, driverRideBookings);
  }, [ride, rideStops, mapVisitOrderRows, mapVisitProgressList, driverRideBookings]);

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

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#166534" />
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
    avatar_url?: string | null;
    vehicle_photo_url?: string | null;
  } | null;
  const isOwn = Boolean(session?.id && ride.driver_id === session.id);
  const available = Math.max(0, Number(ride.available_seats ?? 0));
  const totalSeats = Math.max(0, Number(ride.total_seats ?? 0));
  const status = String(ride.status ?? '');
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

  const canStart = isOwn && (status === 'published' || status === 'booked');
  const canComplete = isOwn && status === 'en_route';
  const canEdit =
    isOwn && status !== 'en_route' && status !== 'completed' && status !== 'cancelled';

  const awaitingStop = Boolean(ride.awaiting_stop_confirmation);
  /** Índice en `rideStops` (ordenado por stop_order). Si ≥ length, ya pasaron todas las paradas (finalizar viaje). */
  const rawStopIdx = Number(ride.current_stop_index ?? 0);
  const rideLen = rideStops.length;
  const hasValidCurrentStop = rideLen > 0 && Number.isFinite(rawStopIdx) && rawStopIdx >= 0 && rawStopIdx < rideLen;
  const currentNavStop = hasValidCurrentStop ? rideStops[rawStopIdx] : undefined;
  const currentStopOrder = currentNavStop != null ? Number(currentNavStop.stop_order) : 0;
  const stopIdxForActualBadge = hasValidCurrentStop ? rawStopIdx : -1;
  const pickupAtCurrentStop = driverRideBookings.filter((b) => bookingPickupNearPublishedStop(b, currentNavStop));
  const dropoffAtCurrentStop = driverRideBookings.filter((b) => bookingDropoffNearPublishedStop(b, currentNavStop));
  const allArriveDecisionsSet = (() => {
    if (pickupAtCurrentStop.length === 0 && dropoffAtCurrentStop.length === 0) return true;
    const hasPickupDecisions = pickupAtCurrentStop.every((b) => {
      const v = arriveDecisions[`pickup:${b.id}`];
      return v === 'boarded' || v === 'no_show';
    });
    const hasDropoffDecisions = dropoffAtCurrentStop.every((b) => {
      const d = arriveDecisions[`dropoff:${b.id}`];
      return d === 'dropped_off' && arrivePaymentConfirmed[b.id] === true;
    });
    return hasPickupDecisions && hasDropoffDecisions;
  })();

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
    if (!currentNavStop) {
      Alert.alert('Parada', 'No hay parada actual para confirmar.');
      return;
    }
    const r = await setRideAwaitingStopConfirmation(rideId, true);
    if (!r.ok) {
      Alert.alert('No se pudo marcar llegada', r.error ?? 'Intentá de nuevo.');
      return;
    }
    setArriveDecisions({});
    setArrivePaymentConfirmed({});
    setArriveModalOpen(true);
    rideVisualSigRef.current = '';
    await load({ quiet: true });
  };

  const submitArriveModal = async () => {
    if (!allArriveDecisionsSet || !currentNavStop || submittingArrive) return;
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
      } catch {
        Alert.alert('Ubicación', 'No se pudo leer tu posición. Revisá que el GPS esté activo e intentá de nuevo.');
        return;
      }
      const passengers: Array<{ id: string; action: 'boarded' | 'no_show' | 'dropped_off' }> = [
        ...pickupAtCurrentStop.map((b) => ({
          id: b.id,
          action: (arriveDecisions[`pickup:${b.id}`] ?? 'boarded') as 'boarded' | 'no_show' | 'dropped_off',
        })),
        ...dropoffAtCurrentStop.map((b) => ({
          id: b.id,
          action: 'dropped_off' as const,
        })),
      ];
      const arrive = await arriveAtStop(rideId, currentStopOrder, passengers, driverLat, driverLng);
      if (!arrive.ok) {
        const code = (arrive.data as { code?: string } | undefined)?.code;
        const msg =
          code === 'driver_too_far_from_stop'
            ? String((arrive.data as { error?: string })?.error ?? arrive.error ?? 'Acercate más a la parada.')
            : (arrive.error ?? 'Intentá de nuevo.');
        Alert.alert('No se pudo confirmar parada', msg);
        return;
      }
      const arrivedBody = arrive.data as { current_stop_index?: unknown } | undefined;
      const nextIdx = arrivedBody?.current_stop_index;
      if (typeof nextIdx === 'number' && Number.isFinite(nextIdx)) {
        setRide((r) => (r ? { ...r, current_stop_index: nextIdx } : r));
      }
      const toPay = dropoffAtCurrentStop.filter((b) => arrivePaymentConfirmed[b.id] === true);
      for (const b of toPay) {
        const paid = await confirmRideBookingPayment(rideId, b.id);
        if (!paid.ok) {
          Alert.alert('Cobro pendiente', `No se pudo confirmar cobro de ${b.price_paid.toLocaleString('es-PY')} PYG.`);
        }
      }
      setArriveModalOpen(false);
      rideVisualSigRef.current = '';
      await load({ quiet: true });
      await refetchDriverBookingPins();
      Alert.alert('Listo', 'Parada confirmada.');
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
          <Text style={styles.sectionLabel}>Ruta</Text>
          {routeNameLine ? <Text style={styles.routeNameLine}>{routeNameLine}</Text> : null}
          <Text style={styles.title}>
            {String(ride.origin_label ?? 'Origen')} → {String(ride.destination_label ?? 'Destino')}
          </Text>
          <RideDetailRouteMap
            ride={ride}
            rideStops={rideStops}
            resolvedRoute={resolvedRideRoute}
            resolvedRouteLoading={resolvedRideRoute.loading}
            height={300}
            otherBookingsGeo={driverBookingPins}
            driverLocation={driverLiveForMap}
          />
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
              <Text style={styles.bodyMuted}>
                Mismo orden que la ruta en el mapa. Verde: parada publicada con “Llegué” confirmado ahí, o subida/bajada
                con registro de pasajero. Amarillo: un solo “En camino” (el primero en este orden que coincide con tu
                parada actual). Navegar abre ese mismo punto.
              </Text>
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
              <TouchableOpacity
                style={styles.collapsibleHit}
                onPress={() => setDriverPublishedStopsExpanded((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={
                  driverPublishedStopsExpanded
                    ? 'Ocultar paradas cargadas al publicar'
                    : 'Mostrar paradas cargadas al publicar'
                }
              >
                <Text style={styles.collapsibleHitText}>
                  {driverPublishedStopsExpanded
                    ? 'Ocultar paradas que cargué al publicar'
                    : 'Ver paradas que cargué al publicar'}
                </Text>
              </TouchableOpacity>
              {driverPublishedStopsExpanded ? (
                <View style={styles.collapsibleBox}>
                  {rideStops.map((s, i) => {
                    const pubProgress = publishedStopRowProgress(
                      s,
                      status,
                      hasValidCurrentStop,
                      stopIdxForActualBadge,
                      i
                    );
                    return (
                      <View
                        key={s.id}
                        style={[
                          styles.stopRowWrap,
                          pubProgress === 'done' && styles.stopRowWrapDone,
                          pubProgress === 'current' && styles.stopRowWrapCurrent,
                        ]}
                      >
                        <View style={styles.stopRow}>
                          <Text style={styles.stopOrder}>{i + 1}.</Text>
                          <Text style={[styles.stopLabel, styles.stopLabelFlex]}>
                            {s.label?.trim() || `Parada ${i + 1}`}
                          </Text>
                          {pubProgress === 'current' ? <Text style={styles.stopCurrentBadge}>En camino</Text> : null}
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </>
          ) : null}
          {isOwn && status === 'en_route' && rideStops.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>Navegación</Text>
              {!hasValidCurrentStop ? (
                <Text style={styles.navHintMuted}>
                  Ya no quedan paradas pendientes en el recorrido. Usá “Finalizar viaje” cuando corresponda.
                </Text>
              ) : (
                <>
                  {awaitingStop ? (
                    <Text style={styles.awaitingBanner}>
                      Pendiente: confirmá subidas/bajadas y cobro en esta parada para poder avanzar.
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
                        void openExternalNavigation(
                          orderedNavigationTarget.lat,
                          orderedNavigationTarget.lng
                        );
                      }}
                      disabled={awaitingStop}
                    >
                      <Text style={styles.navBtnText}>Navegar a la parada actual</Text>
                    </TouchableOpacity>
                  ) : null}
                  <Text style={styles.navHintMuted}>
                    El destino es el punto resaltado “En camino” en la lista de arriba (orden del mapa): subida, bajada o
                    parada publicada. Maps/Waze abren esas coordenadas.
                  </Text>
                </>
              )}
            </>
          ) : null}
        </>
      ) : (
        <>
          {passengerBooking ? (
            <View style={styles.bookingCard}>
              <Text style={styles.bookingCardTitle}>Tu reserva</Text>
              <Text style={styles.bookingMeta}>
                {bookingStatusLabel(passengerBooking.status)}
                {passengerBooking.payment_status
                  ? ` · Pago: ${passengerBooking.payment_status}`
                  : ''}
              </Text>
              <Text style={styles.sectionLabel}>Asientos</Text>
              <Text style={styles.bodyLine}>{passengerBooking.seats_count}</Text>
              {passengerBooking.pickup_label ? (
                <>
                  <Text style={styles.sectionLabel}>Subida</Text>
                  <Text style={styles.bodyLine}>{passengerBooking.pickup_label}</Text>
                </>
              ) : (
                <>
                  <Text style={styles.sectionLabel}>Subida</Text>
                  <Text style={styles.bodyMuted}>Ubicación elegida en el mapa al reservar.</Text>
                </>
              )}
              {passengerBooking.dropoff_label ? (
                <>
                  <Text style={styles.sectionLabel}>Bajada</Text>
                  <Text style={styles.bodyLine}>{passengerBooking.dropoff_label}</Text>
                </>
              ) : (
                <>
                  <Text style={styles.sectionLabel}>Bajada</Text>
                  <Text style={styles.bodyMuted}>Ubicación elegida en el mapa al reservar.</Text>
                </>
              )}
              <Text style={styles.sectionLabel}>Total</Text>
              <Text style={styles.bodyLine}>{passengerBooking.price_paid.toLocaleString('es-PY')} PYG</Text>
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
          {passengerBooking ? (
            <View style={[styles.statusPill, { borderColor: stCfg.color, marginBottom: 12 }]}>
              <View style={[styles.statusDot, { backgroundColor: stCfg.color }]} />
              <Text style={[styles.statusPillText, { color: stCfg.color }]}>
                Viaje: {stCfg.label}
                {status === 'en_route' ? ' · El conductor comparte ubicación en el mapa (punto azul).' : ''}
              </Text>
            </View>
          ) : null}
          {routeNameLine ? <Text style={styles.routeNameLine}>{routeNameLine}</Text> : null}
          <Text style={styles.title}>
            {String(ride.origin_label ?? 'Origen')} → {String(ride.destination_label ?? 'Destino')}
          </Text>
          <RideDetailRouteMap
            ride={ride}
            rideStops={rideStops}
            resolvedRoute={resolvedRideRoute}
            resolvedRouteLoading={resolvedRideRoute.loading}
            height={300}
            passengerBookingGeo={passengerMapGeo}
            coPassengerPickups={mapCoPassengerPickups}
            coPassengerDropoffs={mapCoPassengerDropoffs}
            driverLocation={driverLiveForMap}
          />
          <Text style={styles.sectionLabel}>Salida</Text>
          <Text style={styles.bodyLine}>
            {formatRideDate(depIso)} · {formatRideTime(depIso)}
          </Text>
          <Text style={styles.bodyMuted}>
            {flexible ? 'Ventana ±30 min alrededor de la hora' : 'Salida a horario acordado (±5 min)'}
          </Text>
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
          {durMin > 0 ? (
            <>
              <Text style={styles.sectionLabel}>Duración estimada</Text>
              <Text style={styles.bodyLine}>{durMin} minutos</Text>
            </>
          ) : null}
          {maxDevKm > 0 ? (
            <>
              <Text style={styles.sectionLabel}>Subida y bajada</Text>
              <Text style={styles.bodyMuted}>
                Podés elegir puntos hasta unos {maxDevKm} km a cada lado de la ruta del conductor (al reservar en el mapa).
              </Text>
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
          {rideStops.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>Paradas del recorrido</Text>
              {rideStops.map((s, i) => (
                <View key={s.id} style={[styles.stopRow, { marginTop: 8 }]}>
                  <Text style={styles.stopOrder}>{i + 1}.</Text>
                  <Text style={[styles.stopLabel, styles.stopLabelFlex]}>
                    {s.label?.trim() || `Parada ${i + 1}`}
                  </Text>
                </View>
              ))}
            </>
          ) : null}
          {driver ? (
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Conductor</Text>
              {driver.avatar_url ? (
                <Image source={{ uri: String(driver.avatar_url) }} style={styles.driverAvatar} resizeMode="cover" />
              ) : null}
              <Text style={styles.cardValue}>{driver.full_name ?? '—'}</Text>
              {driver.rating_average != null && (
                <Text style={styles.meta}>★ {Number(driver.rating_average).toFixed(1)}</Text>
              )}
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
          {status === 'en_route' ? (
            <Text style={styles.hint}>
              Usá “Llegué” para confirmar subidas, bajadas y cobro en cada parada.
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
              Llegada a{' '}
              {currentNavStop?.label?.trim() ||
                (hasValidCurrentStop ? `parada ${rawStopIdx + 1}` : 'parada')}
            </Text>
            <ScrollView style={styles.arriveBody}>
              {pickupAtCurrentStop.length === 0 && dropoffAtCurrentStop.length === 0 ? (
                <Text style={styles.bodyMuted}>No hay pasajeros para confirmar en esta parada.</Text>
              ) : null}
              {pickupAtCurrentStop.map((b) => (
                <View key={`p:${b.id}`} style={styles.arriveRow}>
                  <Text style={styles.arriveLabel}>Subida · {b.pickup_label?.trim() || 'Pasajero'}</Text>
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
                      <Text style={styles.arriveChipText}>Subió</Text>
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
              {dropoffAtCurrentStop.map((b) => (
                <View key={`d:${b.id}`} style={styles.arriveRow}>
                  <Text style={styles.arriveLabel}>Bajada · {b.dropoff_label?.trim() || 'Pasajero'}</Text>
                  <Text style={styles.arriveAmount}>{b.price_paid.toLocaleString('es-PY')} PYG</Text>
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
                    <TouchableOpacity
                      style={[
                        styles.arriveChip,
                        arrivePaymentConfirmed[b.id] === true && styles.arriveChipActiveOk,
                      ]}
                      onPress={() =>
                        setArrivePaymentConfirmed((prev) => ({ ...prev, [b.id]: !prev[b.id] }))
                      }
                    >
                      <Text style={styles.arriveChipText}>Cobro confirmado</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
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
                style={[styles.arriveConfirm, (!allArriveDecisionsSet || submittingArrive) && styles.btnDisabled]}
                disabled={!allArriveDecisionsSet || submittingArrive}
                onPress={() => void submitArriveModal()}
              >
                <Text style={styles.arriveConfirmText}>{submittingArrive ? 'Guardando…' : 'Confirmar'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={statusUpdating} transparent animationType="fade">
        <View style={styles.modalOverlay} pointerEvents="box-none">
          <View style={styles.modalCard}>
            <ActivityIndicator size="large" color="#166534" />
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
  routeNameLine: { fontSize: 15, fontWeight: '700', color: '#14532d', marginBottom: 6 },
  title: { fontSize: 18, fontWeight: '700', color: '#111', lineHeight: 24 },
  bodyLine: { fontSize: 15, color: '#111', fontWeight: '500' },
  bodyMuted: { fontSize: 13, color: '#6b7280', marginTop: 4, lineHeight: 18 },
  driverRevenueBox: {
    marginTop: 10,
    padding: 12,
    backgroundColor: '#f0fdf4',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  driverRevenueBlockTitle: {
    fontSize: 11,
    color: '#166534',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontWeight: '700',
  },
  driverRevenueTotal: {
    fontSize: 17,
    fontWeight: '800',
    color: '#14532d',
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
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
  },
  stopRowWrapCurrent: {
    backgroundColor: '#fffbeb',
    borderColor: '#fcd34d',
  },
  stopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  stopOrder: { fontSize: 14, fontWeight: '700', color: '#166534', width: 22 },
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
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderColor: '#e5e7eb',
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
  arriveAmount: {
    marginTop: 5,
    fontSize: 13,
    color: '#166534',
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
    backgroundColor: '#166534',
    borderColor: '#166534',
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
    backgroundColor: '#166534',
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
  bookingCard: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  bookingCardTitle: { fontSize: 17, fontWeight: '800', color: '#14532d', marginBottom: 6 },
  bookingMeta: { fontSize: 13, color: '#166534', marginBottom: 8, fontWeight: '600' },
  cancelBookingBtn: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#b91c1c',
    alignItems: 'center',
  },
  cancelBookingBtnText: { color: '#b91c1c', fontWeight: '700', fontSize: 15 },
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
    backgroundColor: '#166534',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  completeBtn: {
    backgroundColor: '#15803d',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  btnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondaryBtn: { marginTop: 14, alignItems: 'center', paddingVertical: 10 },
  secondaryText: { color: '#166534', fontWeight: '600', fontSize: 15 },
  hint: { fontSize: 13, color: '#6b7280', marginTop: 12, lineHeight: 18 },
  muted: { marginTop: 16, color: '#6b7280' },
  errorText: { color: '#b91c1c', textAlign: 'center', marginBottom: 12 },
  btn: { backgroundColor: '#166534', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8 },
  btnText: { color: '#fff', fontWeight: '700' },
});
