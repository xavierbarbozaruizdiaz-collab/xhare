/**
 * Detalle de viaje: pasajero ve conductor y puede reservar; conductor ve resumen tipo publicación e Iniciar/Finalizar viaje.
 */
import React, { useCallback, useEffect, useState } from 'react';
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
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../backend/supabase';
import { updateRideStatus } from '../backend/rideStatus';
import { fetchRideForReserve, type RideStopForReserve } from '../rides/api';
import type { MainStackParamList } from '../navigation/types';
import { rideStatusConfig, formatRideDate, formatRideTime } from '../ui/rideStatusConfig';
import { openNavigation } from '../external-navigation';
import { RideDetailRouteMap } from '../components/RideDetailRouteMap';

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

  const loadPassengerBooking = useCallback(async () => {
    if (!session?.id) {
      setPassengerBooking(null);
      return;
    }
    const { data, error } = await supabase
      .from('bookings')
      .select('id, status, seats_count, price_paid, pickup_label, dropoff_label, payment_status')
      .eq('ride_id', rideId)
      .eq('passenger_id', session.id)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      setPassengerBooking(null);
      return;
    }
    if (!data) {
      setPassengerBooking(null);
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
    });
  }, [rideId, session?.id]);

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

  useFocusEffect(
    useCallback(() => {
      void loadPassengerBooking();
    }, [loadPassengerBooking])
  );

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

  const openNavToStop = async (s: RideStopForReserve | undefined) => {
    if (!s || !Number.isFinite(s.lat) || !Number.isFinite(s.lng)) {
      Alert.alert('Navegación', 'Esta parada no tiene coordenadas.');
      return;
    }
    const ok = await openNavigation(s.lat, s.lng);
    if (!ok) {
      Alert.alert('Navegación', 'No se pudo abrir la app de mapas. Probá de nuevo o abrí Google Maps manualmente.');
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
          <RideDetailRouteMap ride={ride} rideStops={rideStops} height={300} />
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
                  Pendiente: confirmá subidas/bajadas de pasajeros en la web para poder avanzar de parada.
                </Text>
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
          <RideDetailRouteMap ride={ride} rideStops={rideStops} height={300} />
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
              Para marcar “Llegué” y confirmar pasajeros en cada parada usá la web si tu flujo lo requiere.
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
  navBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  navBtnOutline: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#1d4ed8',
  },
  navBtnTextOutline: { color: '#1d4ed8', fontWeight: '700', fontSize: 15 },
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
