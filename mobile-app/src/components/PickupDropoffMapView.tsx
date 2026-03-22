/**
 * Mapa: subida (A), bajada (B) y hasta 3 paradas intermedias sobre la polyline (snap + corredor).
 */
import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import MapView, { Polyline, Marker, type MapPressEvent } from 'react-native-maps';
import { androidMapProvider } from '../lib/androidMapProvider';
import {
  type Point,
  snapToPolyline,
  distancePointToPolylineMeters,
  getPositionAlongPolyline,
} from '../lib/geo';

export type MapPoint = Point | null;

export type ExtraStopPoint = { lat: number; lng: number; label?: string | null; order: number };

export type DriverStopMarker = { lat: number; lng: number; label?: string | null; stop_order?: number };

type Props = {
  baseRoute: Point[];
  pickup: MapPoint;
  dropoff: MapPoint;
  onPickupChange: (p: MapPoint) => void;
  onDropoffChange: (p: MapPoint) => void;
  /** Máx. distancia a la ruta (metros). Si no se define, no se valida corredor. */
  maxDeviationMeters?: number;
  /** Si true y hay polyline, el toque se proyecta sobre la ruta. */
  snapToRoute?: boolean;
  extraStops?: ExtraStopPoint[];
  onExtraStopsChange?: (stops: ExtraStopPoint[]) => void;
  maxExtraStops?: number;
  driverStops?: DriverStopMarker[];
  existingPickups?: Array<{ lat: number; lng: number; label?: string | null }>;
  existingDropoffs?: Array<{ lat: number; lng: number; label?: string | null }>;
  height?: number;
};

const GREEN = '#166534';

function getRegion(points: Point[]) {
  if (points.length === 0) {
    return { latitude: -25.3, longitude: -57.6, latitudeDelta: 0.5, longitudeDelta: 0.5 };
  }
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const padding = 0.01;
  return {
    latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
    longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    latitudeDelta: Math.max(0.02, Math.max(...lats) - Math.min(...lats) + padding * 2),
    longitudeDelta: Math.max(0.02, Math.max(...lngs) - Math.min(...lngs) + padding * 2),
  };
}

function sortExtraStopsAlongRoute(stops: ExtraStopPoint[], baseRoute: Point[]): ExtraStopPoint[] {
  if (baseRoute.length < 2) return stops;
  return [...stops]
    .map((s) => ({
      ...s,
      _pos: getPositionAlongPolyline({ lat: s.lat, lng: s.lng }, baseRoute),
    }))
    .sort((a, b) => a._pos - b._pos)
    .map(({ _pos, ...s }, idx) => ({ ...s, order: idx + 1 }));
}

export function PickupDropoffMapView({
  baseRoute,
  pickup,
  dropoff,
  onPickupChange,
  onDropoffChange,
  maxDeviationMeters,
  snapToRoute = true,
  extraStops = [],
  onExtraStopsChange,
  maxExtraStops = 3,
  driverStops = [],
  existingPickups = [],
  existingDropoffs = [],
  height = 320,
}: Props) {
  const hasExtras = typeof onExtraStopsChange === 'function';
  const [mode, setMode] = useState<'pickup' | 'dropoff' | 'extra'>('pickup');
  const [tapHint, setTapHint] = useState<string | null>(null);

  useEffect(() => {
    if (!tapHint) return;
    const t = setTimeout(() => setTapHint(null), 4000);
    return () => clearTimeout(t);
  }, [tapHint]);

  const region = useMemo(() => {
    const pts = [...baseRoute];
    if (pickup) pts.push(pickup);
    if (dropoff) pts.push(dropoff);
    extraStops.forEach((s) => pts.push({ lat: s.lat, lng: s.lng }));
    return getRegion(pts);
  }, [baseRoute, pickup, dropoff, extraStops]);

  const polylineCoords = useMemo(
    () => baseRoute.map((p) => ({ latitude: p.lat, longitude: p.lng })),
    [baseRoute]
  );

  const validateCorridor = (p: Point): boolean => {
    if (maxDeviationMeters == null || baseRoute.length < 2) return true;
    const d = distancePointToPolylineMeters(p, baseRoute);
    if (d > maxDeviationMeters) {
      setTapHint(`Ese punto está lejos de la ruta permitida (máx. ${Math.round(maxDeviationMeters)} m).`);
      return false;
    }
    return true;
  };

  const onMapPress = (e: MapPressEvent) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    let p: Point = { lat: latitude, lng: longitude };
    if (snapToRoute && baseRoute.length >= 2) {
      p = snapToPolyline(p, baseRoute);
    }
    if (!validateCorridor(p)) return;

    if (mode === 'pickup') {
      if (dropoff) {
        const pPos = getPositionAlongPolyline(p, baseRoute);
        const dPos = getPositionAlongPolyline(dropoff, baseRoute);
        if (baseRoute.length >= 2 && pPos >= dPos - 1e-5) {
          setTapHint('La subida debe estar antes que la bajada en la ruta.');
          return;
        }
      }
      onPickupChange(p);
      return;
    }
    if (mode === 'dropoff') {
      if (pickup) {
        const pPos = getPositionAlongPolyline(pickup, baseRoute);
        const dPos = getPositionAlongPolyline(p, baseRoute);
        if (baseRoute.length >= 2 && dPos <= pPos + 1e-5) {
          setTapHint('La bajada debe estar después que la subida en la ruta.');
          return;
        }
      }
      onDropoffChange(p);
      return;
    }
    if (mode === 'extra' && hasExtras && onExtraStopsChange) {
      if (!pickup || !dropoff) {
        setTapHint('Primero marcá subida (A) y bajada (B).');
        return;
      }
      if (extraStops.length >= maxExtraStops) {
        setTapHint(`Máximo ${maxExtraStops} paradas intermedias.`);
        return;
      }
      const pPos = getPositionAlongPolyline(p, baseRoute);
      const pu = getPositionAlongPolyline(pickup, baseRoute);
      const du = getPositionAlongPolyline(dropoff, baseRoute);
      if (pPos <= pu + 1e-5 || pPos >= du - 1e-5) {
        setTapHint('La parada debe quedar en el tramo entre tu subida y tu bajada.');
        return;
      }
      const next: ExtraStopPoint[] = sortExtraStopsAlongRoute(
        [...extraStops, { lat: p.lat, lng: p.lng, label: null, order: extraStops.length + 1 }],
        baseRoute
      );
      onExtraStopsChange(next.slice(0, maxExtraStops));
    }
  };

  const sortedDriver = useMemo(
    () =>
      [...driverStops]
        .filter((s) => s.lat != null && s.lng != null)
        .sort((a, b) => (a.stop_order ?? 0) - (b.stop_order ?? 0)),
    [driverStops]
  );

  const removeLastExtra = () => {
    if (!onExtraStopsChange || extraStops.length === 0) return;
    const next = extraStops.slice(0, -1).map((s, i) => ({ ...s, order: i + 1 }));
    onExtraStopsChange(next);
  };

  if (baseRoute.length < 2) {
    return (
      <View style={styles.emptyBox}>
        <Text style={styles.emptyText}>No hay ruta para mostrar en el mapa.</Text>
      </View>
    );
  }

  return (
    <View>
      <View style={styles.modeRow}>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'pickup' && styles.modeBtnActive]}
          onPress={() => setMode('pickup')}
        >
          <Text style={[styles.modeBtnText, mode === 'pickup' && styles.modeBtnTextActive]}>A · Subida</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'dropoff' && styles.modeBtnActive]}
          onPress={() => setMode('dropoff')}
        >
          <Text style={[styles.modeBtnText, mode === 'dropoff' && styles.modeBtnTextActive]}>B · Bajada</Text>
        </TouchableOpacity>
        {hasExtras && pickup && dropoff ? (
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'extra' && styles.modeBtnActive]}
            onPress={() => setMode('extra')}
          >
            <Text style={[styles.modeBtnText, mode === 'extra' && styles.modeBtnTextActive]}>
              + Parada ({extraStops.length}/{maxExtraStops})
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={styles.modeHint}>
        {mode === 'pickup' && 'Tocá la ruta para marcar subida (A).'}
        {mode === 'dropoff' && 'Tocá la ruta para marcar bajada (B).'}
        {mode === 'extra' && hasExtras && 'Tocá entre A y B para agregar una parada intermedia (máx. 3).'}
      </Text>
      {tapHint ? <Text style={styles.warnHint}>{tapHint}</Text> : null}
      <MapView
        provider={androidMapProvider}
        style={[styles.map, { height }]}
        initialRegion={region}
        onPress={onMapPress}
        scrollEnabled
        zoomEnabled
      >
        {polylineCoords.length >= 2 && (
          <Polyline coordinates={polylineCoords} strokeColor={GREEN} strokeWidth={4} />
        )}
        {sortedDriver.map((s, i) => (
          <Marker
            key={`d-${i}-${s.lat}`}
            coordinate={{ latitude: s.lat, longitude: s.lng }}
            title={s.label ? `Parada conductor` : 'Parada'}
            description={s.label ?? undefined}
            pinColor="#6b7280"
          />
        ))}
        {existingPickups.map((p, i) => (
          <Marker
            key={`ep-${i}`}
            coordinate={{ latitude: p.lat, longitude: p.lng }}
            title="Otra subida"
            description={p.label ?? undefined}
            pinColor="#15803d"
          />
        ))}
        {existingDropoffs.map((p, i) => (
          <Marker
            key={`ed-${i}`}
            coordinate={{ latitude: p.lat, longitude: p.lng }}
            title="Otra bajada"
            description={p.label ?? undefined}
            pinColor="#b45309"
          />
        ))}
        {extraStops.map((s, i) => (
          <Marker
            key={`ex-${i}-${s.order}`}
            coordinate={{ latitude: s.lat, longitude: s.lng }}
            title={`Parada ${i + 1}`}
            pinColor="#2563eb"
          />
        ))}
        {pickup && (
          <Marker coordinate={{ latitude: pickup.lat, longitude: pickup.lng }} title="Subida (A)" pinColor="green" />
        )}
        {dropoff && (
          <Marker coordinate={{ latitude: dropoff.lat, longitude: dropoff.lng }} title="Bajada (B)" pinColor="red" />
        )}
      </MapView>
      {hasExtras && extraStops.length > 0 ? (
        <TouchableOpacity style={styles.removeExtraBtn} onPress={removeLastExtra}>
          <Text style={styles.removeExtraText}>Quitar última parada intermedia</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  emptyBox: { padding: 16, backgroundColor: '#fef3c7', borderRadius: 8 },
  emptyText: { color: '#92400e', fontSize: 14 },
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  modeBtn: {
    flexGrow: 1,
    minWidth: '30%',
    paddingVertical: 10,
    marginRight: 6,
    marginBottom: 6,
    borderRadius: 8,
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
  },
  modeBtnActive: { backgroundColor: GREEN },
  modeBtnText: { fontSize: 13, fontWeight: '600', color: '#374151' },
  modeBtnTextActive: { color: '#fff' },
  modeHint: { fontSize: 13, color: '#6b7280', marginBottom: 6 },
  warnHint: { fontSize: 13, color: '#b45309', marginBottom: 6 },
  map: { width: '100%', borderRadius: 12 },
  removeExtraBtn: { marginTop: 8, alignSelf: 'flex-start' },
  removeExtraText: { fontSize: 13, color: '#2563eb', fontWeight: '600' },
});
