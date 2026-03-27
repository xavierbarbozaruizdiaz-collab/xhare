/**
 * Detalle de viaje: pasajero ve conductor y puede reservar; conductor ve resumen tipo publicación e Iniciar/Finalizar viaje.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Alert,
  Modal,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../backend/supabase';
import { updateRideStatus } from '../backend/rideStatus';
import { fetchRideForReserve, type RideStopForReserve } from '../rides/api';
import type { MainStackParamList } from '../navigation/types';
import { rideStatusConfig, formatRideDate, formatRideTime } from '../ui/rideStatusConfig';
import { openNavigation, openNavigationErrorMessage } from '../external-navigation';
import { getNavigationPreference } from '../settings';
import { loadRidePolyline } from '../lib/resolveRidePolyline';
import { RideDetailRouteMap, type PassengerBookingMapGeo } from '../components/RideDetailRouteMap';
import type { Point } from '../lib/geo';
import { sendRideLocation } from '../backend/locationApi';
import { confirmRideBookingPayment, arriveAtStop, setRideAwaitingStopConfirmation } from '../backend/api';
import { requestLocationPermission } from '../permissions';

type Nav = NativeStackNavigationProp<MainStackParamList, 'RideDetail'>;
type ScreenRoute = RouteProp<MainStackParamList, 'RideDetail'>;

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
};

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

function friendlyStatusError(code: string | undefined, details?: string): string {
  switch (code) {
    case 'already_has_active_ride':
      return 'Ya tenés un viaje en curso. Finalizá ese antes de iniciar otro.';
    case 'account_suspended':
      return 'Tu cuenta está suspendida. No podés iniciar ni finalizar viajes hasta regularizar.';
    case 'forbidden':
      return 'No tenés permiso para esta acción.';
    case 'unauthorized':
      return 'Sesión inválida. Volvé a iniciar sesión.';
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
  const [passengerBooking, setPassengerBooking] = useState<PassengerBookingSummary | null>(null);
  const [passengerExtrasGeo, setPassengerExtrasGeo] = useState<Point[]>([]);
  const [driverBookingPins, setDriverBookingPins] = useState<Array<{ pickup: Point; dropoff: Point }>>([]);
  const [driverRideBookings, setDriverRideBookings] = useState<DriverBookingStop[]>([]);
  const [navBasePolyline, setNavBasePolyline] = useState<Point[]>([]);
  const [arriveModalOpen, setArriveModalOpen] = useState(false);
  const [arriveDecisions, setArriveDecisions] = useState<Record<string, 'boarded' | 'no_show' | 'dropped_off'>>({});
  const [arrivePaymentConfirmed, setArrivePaymentConfirmed] = useState<Record<string, boolean>>({});
  const [submittingArrive, setSubmittingArrive] = useState(false);

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

  const refetchDriverBookingPins = useCallback(async () => {
    if (!session?.id || !ride || String(ride.driver_id) !== String(session.id)) {
      setDriverBookingPins([]);
      setDriverRideBookings([]);
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
        if (!quiet) setError('Viaje no encontrado.');
        setRide(null);
        setRideStops([]);
        return;
      }
      setRide(res.ride);
      setRideStops(res.ride_stops ?? []);
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

  useFocusEffect(
    useCallback(() => {
      void loadPassengerBooking();
      void refetchDriverBookingPins();
    }, [loadPassengerBooking, refetchDriverBookingPins])
  );

  useEffect(() => {
    if (!ride || String(ride.status ?? '') !== 'en_route') return;
    const t = setInterval(() => {
      void load({ quiet: true });
      void loadPassengerBooking();
      void refetchDriverBookingPins();
    }, 15_000);
    return () => clearInterval(t);
  }, [ride, load, loadPassengerBooking, refetchDriverBookingPins]);

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

  useEffect(() => {
    if (!ride) {
      setNavBasePolyline([]);
      return;
    }
    let alive = true;
    void loadRidePolyline(ride, rideStops).then((res) => {
      if (alive) setNavBasePolyline(res.points.length >= 2 ? res.points : []);
    });
    return () => {
      alive = false;
    };
  }, [ride, rideStops]);

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

  const driver = ride.driver as { full_name?: string; rating_average?: number } | null;
  const isOwn = Boolean(session?.id && ride.driver_id === session.id);
  const available = Math.max(0, Number(ride.available_seats ?? 0));
  const totalSeats = Math.max(0, Number(ride.total_seats ?? 0));
  const status = String(ride.status ?? '');
  const depIso = ride.departure_time ? String(ride.departure_time) : '';
  const priceSeat = Number(ride.price_per_seat ?? 0);
  const description = ride.description != null ? String(ride.description).trim() : '';
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
  const rawStopIdx = Number(ride.current_stop_index ?? 0);
  const stopIdx =
    rideStops.length > 0 ? Math.min(Math.max(0, rawStopIdx), rideStops.length - 1) : 0;
  const currentNavStop = rideStops.length > 0 ? rideStops[stopIdx] : undefined;
  const nextNavStop =
    rideStops.length > 0 && stopIdx + 1 < rideStops.length ? rideStops[stopIdx + 1] : undefined;
  const currentStopOrder = currentNavStop?.stop_order ?? stopIdx;
  const pickupAtCurrentStop = driverRideBookings.filter(
    (b) => b.pickup_stop_id != null && currentNavStop && b.pickup_stop_id === currentNavStop.id
  );
  const dropoffAtCurrentStop = driverRideBookings.filter(
    (b) => b.dropoff_stop_id != null && currentNavStop && b.dropoff_stop_id === currentNavStop.id
  );
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

  const openNavToStop = async (s: RideStopForReserve | undefined) => {
    if (!s || !Number.isFinite(s.lat) || !Number.isFinite(s.lng)) {
      Alert.alert('Navegación', 'Esta parada no tiene coordenadas.');
      return;
    }
    const pref = await getNavigationPreference();
    let origin: { lat: number; lng: number } | undefined;
    try {
      if (await requestLocationPermission()) {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        origin = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      }
    } catch {
      /* sin GPS aún abrimos nav; Waze usará su propia ubicación */
    }
    // Un solo destino por apertura. `origin` permite evitar Waze 402 (emulador lejos del destino → fallback Maps).
    const result = await openNavigation(s.lat, s.lng, pref, { via: [], ...(origin ? { origin } : {}) });
    if (!result.ok) {
      const { title, body } = openNavigationErrorMessage(pref, result.error);
      Alert.alert(title, body);
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
    await load({ quiet: true });
  };

  const submitArriveModal = async () => {
    if (!allArriveDecisionsSet || !currentNavStop || submittingArrive) return;
    setSubmittingArrive(true);
    try {
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
      const arrive = await arriveAtStop(rideId, currentStopOrder, passengers);
      if (!arrive.ok) {
        Alert.alert('No se pudo confirmar parada', arrive.error ?? 'Intentá de nuevo.');
        return;
      }
      const toPay = dropoffAtCurrentStop.filter((b) => arrivePaymentConfirmed[b.id] === true);
      for (const b of toPay) {
        const paid = await confirmRideBookingPayment(rideId, b.id);
        if (!paid.ok) {
          Alert.alert('Cobro pendiente', `No se pudo confirmar cobro de ${b.price_paid.toLocaleString('es-PY')} PYG.`);
        }
      }
      setArriveModalOpen(false);
      await load({ quiet: true });
      await refetchDriverBookingPins();
      Alert.alert('Listo', 'Parada confirmada.');
    } finally {
      setSubmittingArrive(false);
    }
  };

  return (
    <View style={styles.flexFill}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {isOwn ? (
        <>
          <View style={[styles.statusPill, { borderColor: stCfg.color }]}>
            <View style={[styles.statusDot, { backgroundColor: stCfg.color }]} />
            <Text style={[styles.statusPillText, { color: stCfg.color }]}>{stCfg.label}</Text>
          </View>
          <Text style={styles.sectionLabel}>Ruta</Text>
          <Text style={styles.title}>
            {String(ride.origin_label ?? 'Origen')} → {String(ride.destination_label ?? 'Destino')}
          </Text>
          <RideDetailRouteMap
            ride={ride}
            rideStops={rideStops}
            height={300}
            otherBookingsGeo={driverBookingPins}
            driverLocation={
              Number.isFinite(Number(ride.driver_lat)) && Number.isFinite(Number(ride.driver_lng))
                ? { lat: Number(ride.driver_lat), lng: Number(ride.driver_lng) }
                : null
            }
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
              <Text style={styles.sectionLabel}>Paradas del recorrido</Text>
              {rideStops.map((s, i) => (
                <View key={s.id} style={styles.stopRow}>
                  <Text style={styles.stopOrder}>{i + 1}.</Text>
                  <Text style={styles.stopLabel}>{s.label?.trim() || `Parada ${i + 1}`}</Text>
                  {status === 'en_route' && i === stopIdx ? (
                    <Text style={styles.stopCurrentBadge}>Actual</Text>
                  ) : null}
                </View>
              ))}
            </>
          ) : null}
          {isOwn && status === 'en_route' && rideStops.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>Navegación</Text>
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
              {currentNavStop && Number.isFinite(currentNavStop.lat) && Number.isFinite(currentNavStop.lng) ? (
                <TouchableOpacity
                  style={styles.navBtn}
                  onPress={() => void openNavToStop(currentNavStop)}
                  disabled={awaitingStop}
                >
                  <Text style={styles.navBtnText}>Ir a la parada actual</Text>
                </TouchableOpacity>
              ) : null}
              {nextNavStop &&
              Number.isFinite(nextNavStop.lat) &&
              Number.isFinite(nextNavStop.lng) &&
              nextNavStop.id !== currentNavStop?.id ? (
                <TouchableOpacity
                  style={[styles.navBtn, styles.navBtnOutline]}
                  onPress={() => void openNavToStop(nextNavStop)}
                  disabled={awaitingStop}
                >
                  <Text style={styles.navBtnTextOutline}>Ir a la siguiente parada</Text>
                </TouchableOpacity>
              ) : null}
              {driverBookingPins.length > 0 ? (
                <Text style={styles.navHintMuted}>
                  La ruta en el mapa externo sigue las subidas y bajadas de pasajeros que caen antes de esa parada;
                  si hay varias, se abre Google Maps con paradas intermedias.
                </Text>
              ) : null}
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
            </View>
          ) : null}
          <Text style={styles.title}>
            {String(ride.origin_label ?? 'Origen')} → {String(ride.destination_label ?? 'Destino')}
          </Text>
          <RideDetailRouteMap
            ride={ride}
            rideStops={rideStops}
            height={300}
            passengerBookingGeo={passengerMapGeo}
            driverLocation={
              Number.isFinite(Number(ride.driver_lat)) && Number.isFinite(Number(ride.driver_lng))
                ? { lat: Number(ride.driver_lat), lng: Number(ride.driver_lng) }
                : null
            }
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
                <View key={s.id} style={styles.stopRow}>
                  <Text style={styles.stopOrder}>{i + 1}.</Text>
                  <Text style={styles.stopLabel}>{s.label?.trim() || `Parada ${i + 1}`}</Text>
                </View>
              ))}
            </>
          ) : null}
          {driver ? (
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Conductor</Text>
              <Text style={styles.cardValue}>{driver.full_name ?? '—'}</Text>
              {driver.rating_average != null && (
                <Text style={styles.meta}>★ {Number(driver.rating_average).toFixed(1)}</Text>
              )}
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
              Llegada a {currentNavStop?.label?.trim() || `parada ${currentStopOrder + 1}`}
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
  title: { fontSize: 18, fontWeight: '700', color: '#111', lineHeight: 24 },
  bodyLine: { fontSize: 15, color: '#111', fontWeight: '500' },
  bodyMuted: { fontSize: 13, color: '#6b7280', marginTop: 4, lineHeight: 18 },
  navHintMuted: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 10,
    lineHeight: 17,
  },
  description: { fontSize: 14, color: '#374151', lineHeight: 20 },
  stopRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 },
  stopOrder: { fontSize: 14, fontWeight: '700', color: '#166534', width: 22 },
  stopLabel: { flex: 1, fontSize: 14, color: '#374151', lineHeight: 20 },
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
  navBtnOutline: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#1d4ed8',
  },
  navBtnTextOutline: { color: '#1d4ed8', fontWeight: '700', fontSize: 15 },
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
