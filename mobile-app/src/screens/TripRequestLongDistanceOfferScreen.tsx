/**
 * Conductor: larga distancia — mapa del trayecto (embebido + pantalla completa), ofertas y contraoferta.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  type ViewStyle,
} from 'react-native';
import MapView, { Polyline, Marker } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../backend/supabase';
import { fetchRoute } from '../backend/routeApi';
import { raceWithTimeout } from '../backend/withTimeout';
import { androidMapProvider } from '../lib/androidMapProvider';
import type { MainStackParamList } from '../navigation/types';
import {
  fetchPendingTripRequestOffers,
  fetchProfileDisplayNamesByIds,
  upsertMyTripRequestDriverOffer,
} from '../rides/api';

type Nav = NativeStackNavigationProp<MainStackParamList, 'TripRequestLongDistanceOffer'>;
type R = RouteProp<MainStackParamList, 'TripRequestLongDistanceOffer'>;

const LOAD_MS = 22_000;

type LatLng = { lat: number; lng: number };

function parseStoredPolyline(raw: unknown): LatLng[] {
  if (!Array.isArray(raw)) return [];
  const out: LatLng[] = [];
  for (const p of raw) {
    if (p && typeof p === 'object' && 'lat' in p && 'lng' in p) {
      const lat = Number((p as { lat: unknown }).lat);
      const lng = Number((p as { lng: unknown }).lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) out.push({ lat, lng });
    }
  }
  return out;
}

function regionForPoints(points: LatLng[]) {
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

function TripOfferMapView({
  style,
  region,
  polyline,
  origin,
  destination,
}: {
  style: ViewStyle;
  region: ReturnType<typeof regionForPoints>;
  polyline: LatLng[];
  origin: LatLng | null;
  destination: LatLng | null;
}) {
  const coords =
    polyline.length >= 2
      ? polyline.map((p) => ({ latitude: p.lat, longitude: p.lng }))
      : origin && destination
        ? [
            { latitude: origin.lat, longitude: origin.lng },
            { latitude: destination.lat, longitude: destination.lng },
          ]
        : [];

  return (
    <MapView
      provider={androidMapProvider}
      style={style}
      initialRegion={region}
      scrollEnabled
      zoomEnabled
      rotateEnabled={false}
    >
      {coords.length >= 2 && (
        <Polyline coordinates={coords} strokeColor="#166534" strokeWidth={4} />
      )}
      {origin ? (
        <Marker coordinate={{ latitude: origin.lat, longitude: origin.lng }} title="Origen" pinColor="#166534" />
      ) : null}
      {destination ? (
        <Marker coordinate={{ latitude: destination.lat, longitude: destination.lng }} title="Destino" pinColor="#b91c1c" />
      ) : null}
    </MapView>
  );
}

export function TripRequestLongDistanceOfferScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<R>();
  const { tripRequestId } = route.params;
  const { session } = useAuth();

  const [loading, setLoading] = useState(true);
  const [trip, setTrip] = useState<{
    origin_label: string | null;
    destination_label: string | null;
    requested_date: string;
    requested_time: string | null;
    seats: number;
    passenger_desired_price_per_seat_gs: number | null;
  } | null>(null);
  const [mapOrigin, setMapOrigin] = useState<LatLng | null>(null);
  const [mapDestination, setMapDestination] = useState<LatLng | null>(null);
  const [mapPolyline, setMapPolyline] = useState<LatLng[]>([]);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapFullVisible, setMapFullVisible] = useState(false);

  const [priceInput, setPriceInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [offers, setOffers] = useState<
    Array<{ id: string; driver_id: string; proposed_price_per_seat_gs: number; created_at: string }>
  >([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const mapRegion = useMemo(() => {
    const pts = [...mapPolyline];
    if (mapOrigin) pts.push(mapOrigin);
    if (mapDestination) pts.push(mapDestination);
    return regionForPoints(pts);
  }, [mapPolyline, mapOrigin, mapDestination]);

  const hasMapCoords = mapOrigin != null && mapDestination != null;

  const load = useCallback(async () => {
    if (!session?.id) {
      setLoading(false);
      return;
    }
    setLoadError(null);
    setLoading(true);
    setMapOrigin(null);
    setMapDestination(null);
    setMapPolyline([]);
    try {
      const trQ = supabase
        .from('trip_requests')
        .select(
          'origin_label, destination_label, origin_lat, origin_lng, destination_lat, destination_lng, route_polyline, requested_date, requested_time, seats, pricing_kind, passenger_desired_price_per_seat_gs, status'
        )
        .eq('id', tripRequestId)
        .eq('status', 'pending')
        .maybeSingle();
      const { data: tr, error: trErr } = await raceWithTimeout(
        trQ,
        LOAD_MS,
        () =>
          ({
            data: null,
            error: { message: 'timeout' },
          }) as Awaited<typeof trQ>
      );
      if (trErr || !tr) {
        setTrip(null);
        setLoadError(trErr?.message === 'timeout' ? 'Tiempo de espera.' : 'Solicitud no disponible.');
        setOffers([]);
        return;
      }
      if (tr.pricing_kind !== 'long_distance') {
        setTrip(null);
        setLoadError('Esta solicitud no es larga distancia.');
        setOffers([]);
        return;
      }

      const olat = Number(tr.origin_lat);
      const olng = Number(tr.origin_lng);
      const dlat = Number(tr.destination_lat);
      const dlng = Number(tr.destination_lng);
      const o =
        Number.isFinite(olat) && Number.isFinite(olng) ? { lat: olat, lng: olng } : null;
      const d =
        Number.isFinite(dlat) && Number.isFinite(dlng) ? { lat: dlat, lng: dlng } : null;
      setMapOrigin(o);
      setMapDestination(d);

      let poly = parseStoredPolyline(tr.route_polyline);
      if (poly.length < 2 && o && d) {
        setMapLoading(true);
        try {
          const r = await fetchRoute({ lat: o.lat, lng: o.lng }, { lat: d.lat, lng: d.lng }, []);
          if (r.polyline && r.polyline.length >= 2) {
            poly = r.polyline.map((p) => ({ lat: p.lat, lng: p.lng }));
          }
        } finally {
          setMapLoading(false);
        }
      }
      setMapPolyline(poly);

      setTrip({
        origin_label: tr.origin_label as string | null,
        destination_label: tr.destination_label as string | null,
        requested_date: String(tr.requested_date),
        requested_time: tr.requested_time as string | null,
        seats: Number(tr.seats ?? 1),
        passenger_desired_price_per_seat_gs:
          tr.passenger_desired_price_per_seat_gs != null
            ? Number(tr.passenger_desired_price_per_seat_gs)
            : null,
      });

      const { offers: list, error: oErr } = await fetchPendingTripRequestOffers(tripRequestId);
      if (oErr) setLoadError(oErr);
      setOffers(list);
      const ids = list.map((x) => x.driver_id);
      setNames(await fetchProfileDisplayNamesByIds(ids));

      const mine = list.find((x) => x.driver_id === session.id);
      if (mine) setPriceInput(String(mine.proposed_price_per_seat_gs));
      else if (tr.passenger_desired_price_per_seat_gs != null && Number(tr.passenger_desired_price_per_seat_gs) > 0) {
        setPriceInput(String(Number(tr.passenger_desired_price_per_seat_gs)));
      }
    } finally {
      setLoading(false);
    }
  }, [session?.id, tripRequestId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitOffer = useCallback(async () => {
    if (!session?.id) {
      Alert.alert('Sesión', 'Iniciá sesión de nuevo.');
      return;
    }
    const n = parseInt(priceInput.replace(/\D/g, ''), 10);
    setSubmitting(true);
    try {
      const res = await upsertMyTripRequestDriverOffer({
        tripRequestId,
        driverId: session.id,
        pricePerSeatGs: n,
      });
      if (!res.ok) {
        Alert.alert('No se pudo guardar', res.error ?? 'Error');
        return;
      }
      Alert.alert('Listo', 'Tu precio quedó registrado. El pasajero lo verá junto a los de otros conductores.');
      await load();
    } finally {
      setSubmitting(false);
    }
  }, [session?.id, tripRequestId, priceInput, load]);

  const goPublishRide = useCallback(() => {
    const n = parseInt(priceInput.replace(/\D/g, ''), 10);
    navigation.navigate('PublishRide', {
      tripRequestId,
      publishKind: 'long_distance',
      ...(Number.isFinite(n) && n >= 1000 ? { suggestedSeatPriceGs: n } : {}),
    });
  }, [navigation, tripRequestId, priceInput]);

  if (loading && !trip && !loadError) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  if (!trip) {
    return (
      <View style={styles.centered}>
        <Text style={styles.err}>{loadError ?? 'No se encontró la solicitud.'}</Text>
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.secondaryBtnText}>Volver</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.badge}>Larga distancia</Text>
        <Text style={styles.route} numberOfLines={2}>
          {trip.origin_label ?? 'Origen'} → {trip.destination_label ?? 'Destino'}
        </Text>
        <Text style={styles.meta}>
          Fecha {trip.requested_date}
          {trip.requested_time ? ` · ${String(trip.requested_time).slice(0, 5)}` : ''} · {trip.seats} asiento(s)
        </Text>
        {trip.passenger_desired_price_per_seat_gs != null && trip.passenger_desired_price_per_seat_gs > 0 ? (
          <Text style={styles.passengerPrice}>
            Referencia del pasajero: hasta {trip.passenger_desired_price_per_seat_gs.toLocaleString('es-PY')} Gs/asiento
          </Text>
        ) : null}

        <Text style={styles.section}>Mapa del trayecto</Text>
        {hasMapCoords ? (
          <View style={styles.mapCard}>
            <View style={styles.mapWrap}>
              {mapLoading ? (
                <View style={styles.mapLoading}>
                  <ActivityIndicator color="#166534" />
                  <Text style={styles.mapLoadingText}>Cargando ruta…</Text>
                </View>
              ) : (
                <TripOfferMapView
                  style={styles.map}
                  region={mapRegion}
                  polyline={mapPolyline}
                  origin={mapOrigin}
                  destination={mapDestination}
                />
              )}
            </View>
            <TouchableOpacity
              style={styles.fullscreenBtn}
              onPress={() => setMapFullVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="Abrir mapa en pantalla completa"
            >
              <Text style={styles.fullscreenBtnText}>Pantalla completa</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={styles.muted}>Esta solicitud no tiene coordenadas para mostrar el mapa.</Text>
        )}

        <Text style={styles.section}>Precios que ya ofrecieron otros conductores</Text>
        {offers.length === 0 ? (
          <Text style={styles.muted}>Todavía no hay otras ofertas. Podés ser el primero.</Text>
        ) : (
          offers.map((o) => {
            const isMe = o.driver_id === session?.id;
            const label = names[o.driver_id] ?? 'Conductor';
            return (
              <View key={o.id} style={[styles.offerRow, isMe && styles.offerRowMine]}>
                <Text style={styles.offerName}>
                  {label}
                  {isMe ? ' (vos)' : ''}
                </Text>
                <Text style={styles.offerPrice}>{o.proposed_price_per_seat_gs.toLocaleString('es-PY')} Gs/asiento</Text>
              </View>
            );
          })
        )}

        <Text style={styles.section}>Tu precio por asiento (Gs)</Text>
        <Text style={styles.muted}>Podés actualizarlo cuando quieras; reemplaza tu oferta anterior.</Text>
        <TextInput
          style={styles.input}
          value={priceInput}
          onChangeText={setPriceInput}
          placeholder="Ej. 45000"
          placeholderTextColor="#9ca3af"
          keyboardType="numeric"
        />
        <TouchableOpacity
          style={[styles.primaryBtn, submitting && styles.primaryBtnDisabled]}
          onPress={() => void submitOffer()}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>Guardar mi oferta</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.outlineBtn} onPress={goPublishRide}>
          <Text style={styles.outlineBtnText}>Publicar viaje con este trayecto</Text>
        </TouchableOpacity>
        <Text style={styles.hintFoot}>
          Publicar no reemplaza la oferta: el pasajero sigue pudiendo comparar precios hasta elegir o reservar.
        </Text>
      </ScrollView>

      <Modal
        visible={mapFullVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setMapFullVisible(false)}
      >
        <SafeAreaView style={styles.modalRoot} edges={['top', 'left', 'right']}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Trayecto</Text>
            <TouchableOpacity
              onPress={() => setMapFullVisible(false)}
              style={styles.modalCloseHit}
              accessibilityRole="button"
              accessibilityLabel="Cerrar mapa"
            >
              <Text style={styles.modalCloseText}>Cerrar</Text>
            </TouchableOpacity>
          </View>
          {hasMapCoords ? (
            mapLoading ? (
              <View style={styles.modalMapLoading}>
                <ActivityIndicator size="large" color="#166534" />
                <Text style={styles.mapLoadingText}>Cargando ruta…</Text>
              </View>
            ) : (
              <TripOfferMapView
                style={styles.modalMap}
                region={mapRegion}
                polyline={mapPolyline}
                origin={mapOrigin}
                destination={mapDestination}
              />
            )
          ) : null}
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 16, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  err: { fontSize: 15, color: '#b91c1c', textAlign: 'center', marginBottom: 16 },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#0f766e',
    color: '#fff',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 10,
  },
  route: { fontSize: 17, fontWeight: '700', color: '#111', marginBottom: 6 },
  meta: { fontSize: 14, color: '#6b7280', marginBottom: 8 },
  passengerPrice: { fontSize: 14, color: '#14532d', fontWeight: '600', marginBottom: 16 },
  section: { fontSize: 15, fontWeight: '700', color: '#374151', marginTop: 12, marginBottom: 8 },
  muted: { fontSize: 13, color: '#6b7280', lineHeight: 18, marginBottom: 8 },
  mapCard: { marginBottom: 8 },
  mapWrap: {
    width: '100%',
    height: 220,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#e5e7eb',
  },
  map: { width: '100%', height: '100%' },
  mapLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
  },
  mapLoadingText: { marginTop: 8, fontSize: 13, color: '#6b7280' },
  fullscreenBtn: {
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#166534',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  fullscreenBtnText: { color: '#166534', fontSize: 15, fontWeight: '700' },
  modalRoot: { flex: 1, backgroundColor: '#fff' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#111' },
  modalCloseHit: { paddingVertical: 8, paddingHorizontal: 12 },
  modalCloseText: { fontSize: 16, fontWeight: '600', color: '#166534' },
  modalMap: { flex: 1, width: '100%' },
  modalMapLoading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  offerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginBottom: 8,
  },
  offerRowMine: { borderColor: '#166534', backgroundColor: '#f0fdf4' },
  offerName: { fontSize: 14, color: '#374151', flex: 1, marginRight: 8 },
  offerPrice: { fontSize: 14, fontWeight: '700', color: '#111' },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 12,
    backgroundColor: '#fff',
    color: '#111',
  },
  primaryBtn: {
    backgroundColor: '#166534',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryBtnDisabled: { opacity: 0.7 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  outlineBtn: {
    borderWidth: 2,
    borderColor: '#166534',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  outlineBtnText: { color: '#166534', fontSize: 15, fontWeight: '600' },
  hintFoot: { fontSize: 12, color: '#9ca3af', marginTop: 10, lineHeight: 17 },
  secondaryBtn: { marginTop: 12, paddingVertical: 10, paddingHorizontal: 20 },
  secondaryBtnText: { color: '#166534', fontWeight: '600', fontSize: 15 },
});
