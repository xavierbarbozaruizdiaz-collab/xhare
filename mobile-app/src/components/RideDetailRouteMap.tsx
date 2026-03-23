/**
 * Mapa de solo lectura: polyline del viaje (OSRM guardada o recalculada vía API) y marcadores de paradas del conductor.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import Constants from 'expo-constants';
import MapView, { Polyline, Marker } from 'react-native-maps';
import { androidMapProvider } from '../lib/androidMapProvider';
import { type Point } from '../lib/geo';
import { loadRidePolyline, captionForPolylineSource } from '../lib/resolveRidePolyline';
import type { RideStopForReserve } from '../rides/api';

const GREEN = '#166534';

type Props = {
  ride: Record<string, unknown>;
  rideStops: RideStopForReserve[];
  /** Altura del mapa en px */
  height?: number;
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

export function RideDetailRouteMap({ ride, rideStops, height = 280 }: Props) {
  const [polyline, setPolyline] = useState<Point[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const appFlavor = (Constants.expoConfig?.extra as { APP_FLAVOR?: string } | undefined)?.APP_FLAVOR;

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

  const markerCoords: Point[] = useMemo(() => {
    return sortedStops.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng)).map((s) => ({ lat: s.lat, lng: s.lng }));
  }, [sortedStops]);

  const regionPts = useMemo(() => {
    if (polyline.length >= 2) return polyline;
    return markerCoords;
  }, [polyline, markerCoords]);

  const region = useMemo(() => regionForPoints(regionPts), [regionPts]);

  const polylineCoords = useMemo(
    () => polyline.map((p) => ({ latitude: p.lat, longitude: p.lng })),
    [polyline]
  );

  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return null;
  }

  if (markerCoords.length === 0 && polyline.length < 2) {
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
          {polylineCoords.length >= 2 && (
            <Polyline coordinates={polylineCoords} strokeColor={GREEN} strokeWidth={4} />
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
        </MapView>
        {fetching ? (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator size="large" color={GREEN} />
          </View>
        ) : null}
      </View>
      {note ? <Text style={styles.note}>{note}</Text> : null}
      {__DEV__ && Platform.OS === 'android' && appFlavor === 'driver' ? (
        <Text style={styles.mapsKeyHint}>
          Dev: mapa gris suele ser API key de Maps sin paquete{' '}
          <Text style={styles.mapsKeyMono}>com.xhare.driver</Text> ni SHA correcto en Google Cloud.
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
  mapsKeyHint: { fontSize: 11, color: '#92400e', marginTop: 8, lineHeight: 16 },
  mapsKeyMono: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }), fontSize: 11 },
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
  routeStopStart: { backgroundColor: '#15803d' },
  routeStopMid: { backgroundColor: '#d97706' },
  routeStopEnd: { backgroundColor: '#b91c1c' },
});
