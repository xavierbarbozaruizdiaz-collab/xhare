/**
 * Mapa de solo lectura: misma lógica de recorrido que al reservar (`BookRide`).
 * Gris: OSRM conductor + subidas/bajadas de reservas (`buildMasterBookRidePolyline`).
 * Verde: solo tramo del pasajero con reserva (`buildPassengerMergedRoute` → tramo `mid`).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import MapView, { Polyline, Marker } from 'react-native-maps';
import { androidMapProvider } from '../lib/androidMapProvider';
import { env } from '../core/env';
import { type Point } from '../lib/geo';
import { buildMasterBookRidePolyline } from '../lib/buildMasterBookRidePolyline';
import { captionForPolylineSource, type ResolvedPolyline } from '../lib/resolveRidePolyline';
import type { RideStopForReserve } from '../rides/api';
import { buildPassengerMergedRoute, type PassengerMergedSegments } from '../lib/passengerMergedRoute';
import { driverIntermediateStopsBetween, mergeOsrmWaypointsBetween } from '../lib/passengerRouteWaypoints';

/** Evita pin en (0,0) si algún caller pasa coordenadas basura. */
function isPlausibleGps(p: Point): boolean {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return false;
  if (Math.abs(p.lat) < 1e-5 && Math.abs(p.lng) < 1e-5) return false;
  return true;
}

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
  /** Resuelto una sola vez en RideDetailScreen (mapa + navegación; no duplicar loadRidePolyline). */
  resolvedRoute: ResolvedPolyline;
  resolvedRouteLoading: boolean;
  height?: number;
  /** Pasajero con reserva: A/B, paradas extra y misma OSRM que al reservar (respeta paradas del conductor en el tramo). */
  passengerBookingGeo?: PassengerBookingMapGeo | null;
  /** Conductor: subidas/bajadas de todas las reservas no canceladas. */
  otherBookingsGeo?: Array<{ pickup: Point; dropoff: Point }>;
  /** Pasajero u otro visitante: subidas/bajadas del RPC público (todas las reservas; listas independientes). */
  coPassengerPickups?: Point[];
  coPassengerDropoffs?: Point[];
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
  resolvedRoute,
  resolvedRouteLoading,
  height = 280,
  passengerBookingGeo = null,
  otherBookingsGeo = [],
  coPassengerPickups = [],
  coPassengerDropoffs = [],
  driverLocation = null,
}: Props) {
  const polyline = resolvedRoute.points;
  const note = useMemo(() => {
    if (resolvedRouteLoading) return null;
    return captionForPolylineSource(resolvedRoute.source);
  }, [resolvedRouteLoading, resolvedRoute.source]);
  const fetching = resolvedRouteLoading;

  const [passengerSeg, setPassengerSeg] = useState<PassengerMergedSegments | null>(null);
  const [passengerLineLoading, setPassengerLineLoading] = useState(false);
  /** Conductor + todas las subidas/bajadas de reservas (misma fuente que `BookRide`). */
  const [masterGreyRoute, setMasterGreyRoute] = useState<Point[]>([]);
  const [masterGreyLoading, setMasterGreyLoading] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  const sortedStops = useMemo(
    () => [...rideStops].sort((a, b) => a.stop_order - b.stop_order),
    [rideStops]
  );

  const stopsKey = useMemo(() => sortedStops.map((s) => `${s.id}:${s.stop_order}:${s.lat},${s.lng}`).join('|'), [sortedStops]);
  const rideId = String(ride.id ?? '');
  const stopsRef = useRef(sortedStops);
  const polylineRef = useRef(polyline);
  const mapRef = useRef<React.ComponentRef<typeof MapView>>(null);
  stopsRef.current = sortedStops;
  polylineRef.current = polyline;

  /** Evita re-disparar merge por referencia nueva del mismo array de polyline. */
  const polylineSig = useMemo(() => {
    if (polyline.length < 2) return `n:${polyline.length}`;
    const a = polyline[0];
    const b = polyline[polyline.length - 1];
    return `${polyline.length}|${a.lat},${a.lng}|${b.lat},${b.lng}`;
  }, [polyline]);

  const pbKey = useMemo(() => bookingGeoKey(passengerBookingGeo), [passengerBookingGeo]);

  const obKey = useMemo(
    () =>
      otherBookingsGeo
        .map((b) => `${b.pickup.lat},${b.pickup.lng}|${b.dropoff.lat},${b.dropoff.lng}`)
        .join(';'),
    [otherBookingsGeo]
  );

  const coPassengerKey = useMemo(
    () =>
      [
        ...coPassengerPickups.map((p) => `${p.lat},${p.lng}`),
        ...coPassengerDropoffs.map((p) => `${p.lat},${p.lng}`),
      ].join(';'),
    [coPassengerPickups, coPassengerDropoffs]
  );

  const hasSharedBookingPoints =
    coPassengerPickups.length + coPassengerDropoffs.length > 0 || otherBookingsGeo.length > 0;

  const masterInputsKey = useMemo(
    () => `${polylineSig}|${stopsKey}|${coPassengerKey}|${obKey}`,
    [polylineSig, stopsKey, coPassengerKey, obKey]
  );

  /** Cambio de viaje: overlays derivados; la poly base la pone el padre. */
  useEffect(() => {
    setPassengerSeg(null);
    setMasterGreyRoute([]);
    setPassengerLineLoading(false);
    setMasterGreyLoading(false);
  }, [rideId]);

  /** Una sola poly gris para conductor y para pasajero/visitante: mismo `buildMasterBookRidePolyline` que en reserva. */
  useEffect(() => {
    const pl = polylineRef.current;
    if (pl.length < 2) {
      setMasterGreyRoute([]);
      setMasterGreyLoading(false);
      return;
    }
    if (!hasSharedBookingPoints) {
      setMasterGreyRoute(pl);
      setMasterGreyLoading(false);
      return;
    }
    if (!env.apiBaseUrl?.trim()) {
      setMasterGreyRoute(pl);
      setMasterGreyLoading(false);
      return;
    }
    setMasterGreyRoute(pl);
    let cancelled = false;
    setMasterGreyLoading(true);
    const pickups = [...coPassengerPickups, ...otherBookingsGeo.map((b) => b.pickup)];
    const dropoffs = [...coPassengerDropoffs, ...otherBookingsGeo.map((b) => b.dropoff)];
    void buildMasterBookRidePolyline({
      driverBaseRoute: pl,
      driverStops: stopsRef.current,
      existingPickups: pickups,
      existingDropoffs: dropoffs,
    })
      .then((pts) => {
        if (cancelled) return;
        setMasterGreyRoute(pts.length >= 2 ? pts : pl);
      })
      .finally(() => {
        if (!cancelled) setMasterGreyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [masterInputsKey, hasSharedBookingPoints]);

  const displayBase = useMemo(
    () => (masterGreyRoute.length >= 2 ? masterGreyRoute : polyline),
    [masterGreyRoute, polyline]
  );

  const displayBaseSig = useMemo(() => {
    if (displayBase.length < 2) return '';
    const a = displayBase[0];
    const b = displayBase[displayBase.length - 1];
    return `${displayBase.length}|${a.lat},${a.lng}|${b.lat},${b.lng}`;
  }, [displayBase]);

  useEffect(() => {
    const pl = displayBase.length >= 2 ? displayBase : polylineRef.current;
    if (!passengerBookingGeo || pl.length < 2) {
      setPassengerSeg(null);
      setPassengerLineLoading(false);
      return;
    }
    const { pickup, dropoff, extras = [] } = passengerBookingGeo;
    const stops = stopsRef.current;
    let cancelled = false;
    setPassengerLineLoading(true);
    try {
      const drv = driverIntermediateStopsBetween(pl, pickup, dropoff, stops);
      const wp = mergeOsrmWaypointsBetween(pl, pickup, dropoff, extras, drv, []);
      void buildPassengerMergedRoute(pl, pickup, dropoff, wp)
        .then((seg) => {
          if (cancelled) return;
          setPassengerSeg(seg && seg.mid && seg.mid.length >= 2 ? seg : null);
          setPassengerLineLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          setPassengerSeg(null);
          setPassengerLineLoading(false);
        });
    } catch {
      if (!cancelled) {
        setPassengerSeg(null);
        setPassengerLineLoading(false);
      }
    }
    return () => {
      cancelled = true;
    };
  }, [pbKey, displayBaseSig, stopsKey]);

  const markerCoords: Point[] = useMemo(() => {
    return sortedStops.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng)).map((s) => ({ lat: s.lat, lng: s.lng }));
  }, [sortedStops]);

  const regionPts = useMemo(() => {
    const pts: Point[] = [...displayBase];
    if (passengerSeg?.mid?.length) pts.push(...passengerSeg.mid);
    if (passengerBookingGeo) {
      pts.push(passengerBookingGeo.pickup, passengerBookingGeo.dropoff);
      (passengerBookingGeo.extras ?? []).forEach((p) => pts.push(p));
    }
    otherBookingsGeo.forEach((b) => {
      pts.push(b.pickup, b.dropoff);
    });
    coPassengerPickups.forEach((p) => pts.push(p));
    coPassengerDropoffs.forEach((p) => pts.push(p));
    /** Pin del conductor se dibuja aparte; no incluir en el bbox evita que cada actualización de GPS mueva la cámara. */
    if (pts.length >= 2) return pts;
    if (displayBase.length >= 2) return displayBase;
    return markerCoords;
  }, [
    displayBase,
    passengerSeg,
    passengerBookingGeo,
    otherBookingsGeo,
    coPassengerPickups,
    coPassengerDropoffs,
    markerCoords,
  ]);

  const region = useMemo(() => regionForPoints(regionPts), [regionPts]);

  const regionPtsRef = useRef(regionPts);
  regionPtsRef.current = regionPts;

  /**
   * Un solo remount por viaje: `key` id+L/S reabría el SQLite del SDK en cada poly y empeora
   * `Database lock unavailable` en emulador (NativeSqliteDiskCache).
   */
  const mapViewKey = rideId;

  useEffect(() => {
    setMapReady(false);
  }, [rideId]);

  /** Solo cuando cambia la “forma” de la ruta; evita fit en cada render → menos Skipped frames / Davey. */
  const mapFitKey = useMemo(
    () =>
      `${rideId}|db${displayBase.length}|pm${passengerSeg?.mid?.length ?? 0}|mk${markerCoords.length}|cp${coPassengerPickups.length}|cd${coPassengerDropoffs.length}`,
    [
      rideId,
      displayBase.length,
      passengerSeg?.mid?.length,
      markerCoords.length,
      coPassengerPickups.length,
      coPassengerDropoffs.length,
    ]
  );

  useEffect(() => {
    if (!mapReady) return;
    const pts = regionPtsRef.current;
    if (pts.length < 2) return;
    const coords = pts
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .map((p) => ({ latitude: p.lat, longitude: p.lng }));
    if (coords.length < 2) return;
    const delayMs = Platform.OS === 'android' ? 650 : 180;
    const t = setTimeout(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            mapRef.current?.fitToCoordinates(coords, {
              edgePadding: { top: 28, right: 28, bottom: 28, left: 28 },
              animated: Platform.OS !== 'android',
            });
          } catch {
            /* mapa aún midiendo */
          }
        });
      });
    }, delayMs);
    return () => clearTimeout(t);
  }, [mapReady, mapFitKey]);

  const displayBaseCoords = useMemo(
    () =>
      displayBase
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
        .map((p) => ({ latitude: p.lat, longitude: p.lng })),
    [displayBase]
  );

  const passengerMidCoords = useMemo(() => {
    const mid = passengerSeg?.mid;
    if (!mid?.length) return [] as { latitude: number; longitude: number }[];
    return mid
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .map((p) => ({ latitude: p.lat, longitude: p.lng }));
  }, [passengerSeg]);

  const showOtherPins = otherBookingsGeo.length > 0;
  const showCoPassengerPins = coPassengerPickups.length > 0 || coPassengerDropoffs.length > 0;
  /** Gris cuando hay recorrido compartido (reservas) o pasajero viendo su tramo sobre la base. */
  const baseLineUsesSlate = hasSharedBookingPoints || Boolean(passengerBookingGeo);
  const baseLineColor = baseLineUsesSlate ? SLATE : GREEN;
  const baseLineWidth = baseLineUsesSlate ? 3 : 4;

  const routeStillLoading =
    fetching ||
    (passengerBookingGeo && passengerLineLoading) ||
    (hasSharedBookingPoints && masterGreyLoading && polyline.length < 2);
  /**
   * Nunca tapar el mapa a pantalla completa: con polyline ya dibujada pero `fetching` aún true
   * (efectos solapados / emulador) el overlay central parecía “carga infinita”. Solo indicador chico.
   */
  const showRouteLoadingBadge = routeStillLoading;

  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return null;
  }

  if (
    markerCoords.length === 0 &&
    displayBaseCoords.length < 2 &&
    passengerMidCoords.length < 2 &&
    !passengerBookingGeo &&
    otherBookingsGeo.length === 0 &&
    coPassengerPickups.length === 0 &&
    coPassengerDropoffs.length === 0
  ) {
    return (
      <View style={[styles.fallbackBox, { minHeight: height * 0.35 }]}>
        <Text style={styles.fallbackText}>Este viaje no tiene coordenadas de ruta para mostrar en el mapa.</Text>
      </View>
    );
  }

  return (
    <View style={styles.block}>
      <Text style={styles.sectionLabel}>Mapa del recorrido</Text>
      <View style={[styles.mapShell, { height }]} collapsable={Platform.OS === 'android' ? false : undefined}>
        <MapView
          key={mapViewKey}
          ref={mapRef}
          provider={androidMapProvider}
          style={StyleSheet.absoluteFill}
          initialRegion={region}
          onMapReady={() => setMapReady(true)}
          loadingEnabled={Platform.OS !== 'android'}
          scrollEnabled
          zoomEnabled
          rotateEnabled={false}
        >
          {displayBaseCoords.length >= 2 ? (
            <Polyline
              coordinates={displayBaseCoords}
              strokeColor={baseLineColor}
              strokeWidth={baseLineWidth}
              lineCap="round"
              lineJoin="round"
              zIndex={1}
            />
          ) : null}
          {passengerMidCoords.length >= 2 ? (
            <Polyline
              coordinates={passengerMidCoords}
              strokeColor={GREEN}
              strokeWidth={5}
              lineCap="round"
              lineJoin="round"
              zIndex={2}
            />
          ) : null}
          {sortedStops.map((s, i) => {
            if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) return null;
            const last = i === sortedStops.length - 1;
            const title = `${i + 1}. ${s.label?.trim() || (i === 0 ? 'Salida' : last ? 'Llegada' : 'Parada')}`;
            return (
              <Marker
                key={s.id || `stop-${i}`}
                coordinate={{ latitude: s.lat, longitude: s.lng }}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
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
                tracksViewChanges={false}
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
                tracksViewChanges={false}
                title="Tu bajada"
              >
                <View style={[styles.routeStopDot, styles.passengerDropDot]} collapsable={false} />
              </Marker>
              {(passengerBookingGeo.extras ?? []).map((p, i) => (
                <Marker
                  key={`pex-${i}`}
                  coordinate={{ latitude: p.lat, longitude: p.lng }}
                  anchor={{ x: 0.5, y: 0.5 }}
                  tracksViewChanges={false}
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
                tracksViewChanges={false}
                title={`Subida pasajero ${i + 1}`}
              >
                <View style={styles.otherPassengerPin} collapsable={false} />
              </Marker>
              <Marker
                coordinate={{ latitude: b.dropoff.lat, longitude: b.dropoff.lng }}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
                title={`Bajada pasajero ${i + 1}`}
              >
                <View style={styles.otherPassengerPin} collapsable={false} />
              </Marker>
            </React.Fragment>
          ))}
          {coPassengerPickups.map((p, i) => (
            <Marker
              key={`cp-${i}-${p.lat},${p.lng}`}
              coordinate={{ latitude: p.lat, longitude: p.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
              title={`Subida de otro pasajero ${i + 1}`}
            >
              <View style={styles.otherPassengerPin} collapsable={false} />
            </Marker>
          ))}
          {coPassengerDropoffs.map((p, i) => (
            <Marker
              key={`cd-${i}-${p.lat},${p.lng}`}
              coordinate={{ latitude: p.lat, longitude: p.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
              title={`Bajada de otro pasajero ${i + 1}`}
            >
              <View style={styles.otherPassengerPin} collapsable={false} />
            </Marker>
          ))}
          {driverLocation && isPlausibleGps(driverLocation) ? (
            <Marker
              coordinate={{ latitude: driverLocation.lat, longitude: driverLocation.lng }}
              anchor={{ x: 0.5, y: 1 }}
              tracksViewChanges={false}
              zIndex={100}
              title="Conductor en camino"
            >
              <View style={styles.driverMarkerWrap} collapsable={false}>
                <View style={styles.driverTriangle} collapsable={false} />
              </View>
            </Marker>
          ) : null}
        </MapView>
        {showRouteLoadingBadge ? (
          <View style={styles.cornerSpinner} pointerEvents="none">
            <ActivityIndicator size="small" color={GREEN} />
          </View>
        ) : null}
      </View>
      {note ? <Text style={styles.note}>{note}</Text> : null}
      {passengerBookingGeo && passengerMidCoords.length < 2 && !passengerLineLoading ? (
        <Text style={styles.noteMuted}>
          Tu tramo por calles no pudo calcularse ahora; igual ves subida y bajada en el mapa.
        </Text>
      ) : null}
      {showOtherPins && !passengerBookingGeo && displayBaseCoords.length < 2 && !masterGreyLoading ? (
        <Text style={styles.noteMuted}>
          La ruta por calles con todas las reservas no está dibujada; se muestra la ruta publicada y las subidas/bajadas
          de pasajeros. La navegación externa sí puede incluir esas paradas intermedias.
        </Text>
      ) : null}
      {showCoPassengerPins && passengerBookingGeo ? (
        <Text style={styles.noteMuted}>
          Gris: recorrido compartido (conductor + reservas). Verde: solo tu tramo por calle entre subida y bajada. Tus
          paradas siguen en azul y violeta.
        </Text>
      ) : null}
      {showCoPassengerPins && !passengerBookingGeo && displayBaseCoords.length >= 2 ? (
        <Text style={styles.noteMuted}>
          Línea gris: ruta por calle con paradas del conductor y subidas/bajadas ya reservadas.
        </Text>
      ) : null}
      {showCoPassengerPins && !passengerBookingGeo && displayBaseCoords.length < 2 && !masterGreyLoading ? (
        <Text style={styles.noteMuted}>
          Hay reservas de otros pasajeros; si no ves la ruta por calle, reintentá más tarde o revisá la conexión.
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
  cornerSpinner: {
    position: 'absolute',
    top: 10,
    right: 10,
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.92)',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
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
  routeStopStart: { backgroundColor: '#15803d' },
  routeStopMid: { backgroundColor: '#d97706' },
  /** Subidas/bajadas de otros pasajeros: más chicos que los del usuario que mira el mapa. */
  otherPassengerPin: {
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#fff',
    backgroundColor: '#475569',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 1.5,
        shadowOffset: { width: 0, height: 1 },
      },
      android: { elevation: 2 },
    }),
  },
  routeStopEnd: { backgroundColor: '#b91c1c' },
  /** Triángulo = “proa” del conductor; ancla en la base (coordenada en el suelo del vehículo). */
  driverMarkerWrap: {
    width: 22,
    height: 20,
    alignItems: 'center',
    justifyContent: 'flex-end',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 2,
        shadowOffset: { width: 0, height: 1 },
      },
      android: { elevation: 4 },
    }),
  },
  driverTriangle: {
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 15,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#1d4ed8',
    borderTopWidth: 0,
  },
});
