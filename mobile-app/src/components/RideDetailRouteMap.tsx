/**
 * Mapa de solo lectura: ruta del conductor + opcional ruta del pasajero (reserva) y pins de otras reservas (conductor).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import MapView, { Polyline, Marker } from 'react-native-maps';
import { androidMapProvider } from '../lib/androidMapProvider';
import { type Point } from '../lib/geo';
import { loadRidePolyline, captionForPolylineSource } from '../lib/resolveRidePolyline';
import type { RideStopForReserve } from '../rides/api';
import {
  buildPassengerMergedRoute,
  buildDriverMergedRouteThroughBookings,
  concatPassengerMergedParts,
} from '../lib/passengerMergedRoute';
import {
  driverIntermediateStopsBetween,
  mergeOsrmWaypointsBetween,
} from '../lib/passengerRouteWaypoints';

const GREEN = '#166534';
const SLATE = '#64748b';
const PASSENGER_AB = '#2563eb';
const PASSENGER_EXTRA = '#0891b2';

export type PassengerBookingMapGeo = {
  pickup: Point;
  dropoff: Point;
  extras?: Point[];
};

type Props = {
  ride: Record<string, unknown>;
  rideStops: RideStopForReserve[];
  height?: number;
  /** Pasajero con reserva: A/B, paradas extra y misma OSRM que al reservar (respeta paradas del conductor en el tramo). */
  passengerBookingGeo?: PassengerBookingMapGeo | null;
  /** Conductor: subidas/bajadas de todas las reservas no canceladas. */
  otherBookingsGeo?: Array<{ pickup: Point; dropoff: Point }>;
  /** Posición actual del conductor durante el viaje en curso (pasajero). */
  driverLocation?: Point | null;
};

function regionForPoints(pts: Point[]) {
  if (pts.length === 0) {
    return { latitude: -25.3, longitude: -57.6, latitudeDelta: 0.35, longitudeDelta: 0.35 };
  }
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  const pad = 0.012;
  return {
    latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
    longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    latitudeDelta: Math.max(0.025, Math.max(...lats) - Math.min(...lats) + pad * 2),
    longitudeDelta: Math.max(0.025, Math.max(...lngs) - Math.min(...lngs) + pad * 2),
  };
}

function bookingGeoKey(g: PassengerBookingMapGeo | null | undefined): string {
  if (!g) return '';
  const ex = (g.extras ?? []).map((p) => `${p.lat},${p.lng}`).join(';');
  return `${g.pickup.lat},${g.pickup.lng}|${g.dropoff.lat},${g.dropoff.lng}|${ex}`;
}

export function RideDetailRouteMap({
  ride,
  rideStops,
  height = 280,
  passengerBookingGeo = null,
  otherBookingsGeo = [],
  driverLocation = null,
}: Props) {
  const [polyline, setPolyline] = useState<Point[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [passengerLine, setPassengerLine] = useState<Point[]>([]);
  const [passengerLineLoading, setPassengerLineLoading] = useState(false);
  const [driverBookingsLine, setDriverBookingsLine] = useState<Point[]>([]);
  const [driverBookingsLineLoading, setDriverBookingsLineLoading] = useState(false);

  const sortedStops = useMemo(
    () => [...rideStops].sort((a, b) => a.stop_order - b.stop_order),
    [rideStops]
  );

  const polyLen = Array.isArray(ride.base_route_polyline) ? (ride.base_route_polyline as unknown[]).length : 0;
  const stopsKey = useMemo(() => sortedStops.map((s) => `${s.id}:${s.stop_order}:${s.lat},${s.lng}`).join('|'), [sortedStops]);
  const rideId = String(ride.id ?? '');
  const rideRef = useRef(ride);
  const stopsRef = useRef(sortedStops);
  rideRef.current = ride;
  stopsRef.current = sortedStops;

  const pbKey = useMemo(() => bookingGeoKey(passengerBookingGeo), [passengerBookingGeo]);

  const obKey = useMemo(
    () =>
      otherBookingsGeo
        .map((b) => `${b.pickup.lat},${b.pickup.lng}|${b.dropoff.lat},${b.dropoff.lng}`)
        .join(';'),
    [otherBookingsGeo]
  );

  useEffect(() => {
    let cancelled = false;
    setFetching(true);
    setNote(null);

    void (async () => {
      const r = rideRef.current;
      const stops = stopsRef.current;
      const { points, source } = await loadRidePolyline(r, stops);
      if (cancelled) return;
      setPolyline(points);
      setNote(captionForPolylineSource(source));
      setFetching(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [rideId, polyLen, stopsKey]);

  useEffect(() => {
    if (!passengerBookingGeo || polyline.length < 2) {
      setPassengerLine([]);
      setPassengerLineLoading(false);
      return;
    }
    const { pickup, dropoff, extras = [] } = passengerBookingGeo;
    let cancelled = false;
    setPassengerLineLoading(true);
    const drv = driverIntermediateStopsBetween(polyline, pickup, dropoff, sortedStops);
    const wp = mergeOsrmWaypointsBetween(polyline, pickup, dropoff, extras, drv);
    void buildPassengerMergedRoute(polyline, pickup, dropoff, wp).then((seg) => {
      if (cancelled) return;
      if (seg) setPassengerLine(concatPassengerMergedParts(seg));
      else setPassengerLine([]);
      setPassengerLineLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [pbKey, polyline, stopsKey, sortedStops]);

  useEffect(() => {
    if (passengerBookingGeo != null || otherBookingsGeo.length === 0 || polyline.length < 2) {
      setDriverBookingsLine([]);
      setDriverBookingsLineLoading(false);
      return;
    }
    let cancelled = false;
    setDriverBookingsLineLoading(true);
    void buildDriverMergedRouteThroughBookings(polyline, sortedStops, otherBookingsGeo).then((pts) => {
      if (cancelled) return;
      setDriverBookingsLine(pts ?? []);
      setDriverBookingsLineLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [obKey, polyline, stopsKey, passengerBookingGeo, sortedStops]);

  const markerCoords: Point[] = useMemo(() => {
    return sortedStops.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng)).map((s) => ({ lat: s.lat, lng: s.lng }));
  }, [sortedStops]);

  const regionPts = useMemo(() => {
    const pts: Point[] = [...polyline, ...passengerLine, ...driverBookingsLine];
    if (passengerBookingGeo) {
      pts.push(passengerBookingGeo.pickup, passengerBookingGeo.dropoff);
      (passengerBookingGeo.extras ?? []).forEach((p) => pts.push(p));
    }
    otherBookingsGeo.forEach((b) => {
      pts.push(b.pickup, b.dropoff);
    });
    if (driverLocation && Number.isFinite(driverLocation.lat) && Number.isFinite(driverLocation.lng)) {
      pts.push(driverLocation);
    }
    if (pts.length >= 2) return pts;
    if (polyline.length >= 2) return polyline;
    if (passengerLine.length >= 2) return passengerLine;
    if (driverBookingsLine.length >= 2) return driverBookingsLine;
    return markerCoords;
  }, [polyline, passengerLine, driverBookingsLine, passengerBookingGeo, otherBookingsGeo, markerCoords, driverLocation]);

  const region = useMemo(() => regionForPoints(regionPts), [regionPts]);

  const polylineCoords = useMemo(
    () => polyline.map((p) => ({ latitude: p.lat, longitude: p.lng })),
    [polyline]
  );

  const passengerLineCoords = useMemo(
    () => passengerLine.map((p) => ({ latitude: p.lat, longitude: p.lng })),
    [passengerLine]
  );

  const driverBookingsLineCoords = useMemo(
    () => driverBookingsLine.map((p) => ({ latitude: p.lat, longitude: p.lng })),
    [driverBookingsLine]
  );

  const overlayLineCoords = passengerLineCoords.length >= 2 ? passengerLineCoords : driverBookingsLineCoords;

  const emphasizePassenger = Boolean(passengerBookingGeo);
  const showOtherPins = otherBookingsGeo.length > 0;
  /** Una sola ruta “principal”: si el merge con reservas existe, no duplicar la polyline publicada. */
  const hideBaseUnderDriverMerged =
    showOtherPins && !passengerBookingGeo && driverBookingsLine.length >= 2;
  const driverLineColor = emphasizePassenger || showOtherPins ? SLATE : GREEN;
  const driverLineWidth = emphasizePassenger || showOtherPins ? 3 : 4;

  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return null;
  }

  if (markerCoords.length === 0 && polyline.length < 2 && overlayLineCoords.length < 2) {
    return (
      <View style={[styles.fallbackBox, { minHeight: height * 0.35 }]}>
        <Text style={styles.fallbackText}>Este viaje no tiene coordenadas de ruta para mostrar en el mapa.</Text>
      </View>
    );
  }

  return (
    <View style={styles.block}>
      <Text style={styles.sectionLabel}>Mapa del recorrido</Text>
      <View style={[styles.mapShell, { height }]}>
        <MapView
          provider={androidMapProvider}
          style={StyleSheet.absoluteFill}
          initialRegion={region}
          scrollEnabled
          zoomEnabled
          rotateEnabled={false}
        >
          {polylineCoords.length >= 2 && !hideBaseUnderDriverMerged ? (
            <Polyline coordinates={polylineCoords} strokeColor={driverLineColor} strokeWidth={driverLineWidth} />
          ) : null}
          {overlayLineCoords.length >= 2 && (
            <Polyline coordinates={overlayLineCoords} strokeColor={GREEN} strokeWidth={5} />
          )}
          {sortedStops.map((s, i) => {
            if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) return null;
            const last = i === sortedStops.length - 1;
            const title = `${i + 1}. ${s.label?.trim() || (i === 0 ? 'Salida' : last ? 'Llegada' : 'Parada')}`;
            return (
              <Marker
                key={s.id || `stop-${i}`}
                coordinate={{ latitude: s.lat, longitude: s.lng }}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={Platform.OS === 'android'}
                title={title}
              >
                <View
                  style={[
                    styles.routeStopDot,
                    i === 0 ? styles.routeStopStart : last ? styles.routeStopEnd : styles.routeStopMid,
                  ]}
                  collapsable={false}
                />
              </Marker>
            );
          })}
          {passengerBookingGeo ? (
            <>
              <Marker
                coordinate={{
                  latitude: passengerBookingGeo.pickup.lat,
                  longitude: passengerBookingGeo.pickup.lng,
                }}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={Platform.OS === 'android'}
                title="Tu subida"
              >
                <View style={[styles.routeStopDot, styles.passengerPickupDot]} collapsable={false} />
              </Marker>
              <Marker
                coordinate={{
                  latitude: passengerBookingGeo.dropoff.lat,
                  longitude: passengerBookingGeo.dropoff.lng,
                }}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={Platform.OS === 'android'}
                title="Tu bajada"
              >
                <View style={[styles.routeStopDot, styles.passengerDropDot]} collapsable={false} />
              </Marker>
              {(passengerBookingGeo.extras ?? []).map((p, i) => (
                <Marker
                  key={`pex-${i}`}
                  coordinate={{ latitude: p.lat, longitude: p.lng }}
                  anchor={{ x: 0.5, y: 0.5 }}
                  tracksViewChanges={Platform.OS === 'android'}
                  title={`Tu parada ${i + 1}`}
                >
                  <View style={[styles.routeStopDot, styles.passengerExtraDot]} collapsable={false} />
                </Marker>
              ))}
            </>
          ) : null}
          {otherBookingsGeo.map((b, i) => (
            <React.Fragment key={`ob-${i}`}>
              <Marker
                coordinate={{ latitude: b.pickup.lat, longitude: b.pickup.lng }}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={Platform.OS === 'android'}
                title={`Subida pasajero ${i + 1}`}
              >
                <View style={[styles.smallPin, styles.otherPickup]} collapsable={false} />
              </Marker>
              <Marker
                coordinate={{ latitude: b.dropoff.lat, longitude: b.dropoff.lng }}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={Platform.OS === 'android'}
                title={`Bajada pasajero ${i + 1}`}
              >
                <View style={[styles.smallPin, styles.otherDropoff]} collapsable={false} />
              </Marker>
            </React.Fragment>
          ))}
          {driverLocation && Number.isFinite(driverLocation.lat) && Number.isFinite(driverLocation.lng) ? (
            <Marker
              coordinate={{ latitude: driverLocation.lat, longitude: driverLocation.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={Platform.OS === 'android'}
              title="Conductor en camino"
            >
              <View style={[styles.routeStopDot, styles.driverLiveDot]} collapsable={false} />
            </Marker>
          ) : null}
        </MapView>
        {fetching || passengerLineLoading || driverBookingsLineLoading ? (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator size="large" color={GREEN} />
          </View>
        ) : null}
      </View>
      {note ? <Text style={styles.note}>{note}</Text> : null}
      {passengerBookingGeo && passengerLine.length < 2 && !passengerLineLoading ? (
        <Text style={styles.noteMuted}>
          Tu tramo por calles no pudo calcularse ahora; igual ves subida y bajada en el mapa.
        </Text>
      ) : null}
      {showOtherPins && !passengerBookingGeo && driverBookingsLine.length < 2 && !driverBookingsLineLoading ? (
        <Text style={styles.noteMuted}>
          La ruta ajustada por las reservas no pudo calcularse ahora; ves la ruta publicada y los puntos de subida/bajada.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginBottom: 8 },
  sectionLabel: {
    fontSize: 11,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  mapShell: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#f3f4f6',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  note: { fontSize: 12, color: '#6b7280', marginTop: 8, lineHeight: 17 },
  noteMuted: { fontSize: 11, color: '#9ca3af', marginTop: 6, lineHeight: 16 },
  fallbackBox: {
    padding: 14,
    backgroundColor: '#f9fafb',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginBottom: 8,
    justifyContent: 'center',
  },
  fallbackText: { fontSize: 14, color: '#6b7280', textAlign: 'center', lineHeight: 20 },
  routeStopDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#fff',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 2,
        shadowOffset: { width: 0, height: 1 },
      },
      android: { elevation: 3 },
    }),
  },
  passengerPickupDot: { backgroundColor: PASSENGER_AB, width: 18, height: 18, borderRadius: 9 },
  passengerDropDot: { backgroundColor: '#7c3aed', width: 18, height: 18, borderRadius: 9 },
  passengerExtraDot: { backgroundColor: PASSENGER_EXTRA, width: 15, height: 15, borderRadius: 8 },
  smallPin: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#fff',
    ...Platform.select({ android: { elevation: 2 } }),
  },
  otherPickup: { backgroundColor: '#0ea5e9' },
  otherDropoff: { backgroundColor: '#f97316' },
  routeStopStart: { backgroundColor: '#15803d' },
  routeStopMid: { backgroundColor: '#d97706' },
  routeStopEnd: { backgroundColor: '#b91c1c' },
  driverLiveDot: { backgroundColor: '#1d4ed8', width: 18, height: 18, borderRadius: 9 },
});
