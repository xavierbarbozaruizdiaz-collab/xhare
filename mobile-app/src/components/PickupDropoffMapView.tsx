/**
 * Mapa: subida (A), bajada (B) y hasta 3 paradas intermedias.
 * Con API: gris = recorte de la ruta publicada; verde = OSRM que conecta a la ruta y pasa por A/paradas/B.
 * Sin fusión OSRM: verde = recorte de la misma polyline del conductor entre A y B.
 */
import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  StatusBar,
  Platform,
  Pressable,
  Alert,
} from 'react-native';
import MapView, { Polyline, Marker, type MapPressEvent, type Region } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { androidMapProvider } from '../lib/androidMapProvider';
import {
  type Point,
  snapToPolyline,
  distancePointToPolylineMeters,
  getPositionAlongPolyline,
  slicePolylineBetweenT,
  passengerSegmentAlongBaseRoute,
} from '../lib/geo';
import type { PassengerMergedSegments } from '../lib/passengerMergedRoute';
import { getLocationPermissionStatus, requestLocationPermission } from '../permissions';

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
  /** Si true, tras validar el corredor el punto se proyecta sobre la polyline base. */
  snapToRoute?: boolean;
  extraStops?: ExtraStopPoint[];
  onExtraStopsChange?: (stops: ExtraStopPoint[]) => void;
  maxExtraStops?: number;
  driverStops?: DriverStopMarker[];
  existingPickups?: Array<{ lat: number; lng: number; label?: string | null }>;
  existingDropoffs?: Array<{ lat: number; lng: number; label?: string | null }>;
  height?: number;
  /**
   * Ruta fusionada (recorte conductor + OSRM por A/paradas/B). Si `mid` tiene ≥2 puntos, reemplaza el recorte solo sobre la base.
   */
  resolvedPassengerRoute?: PassengerMergedSegments | null;
};

const GREEN = '#166534';
/** Ruta publicada del conductor (referencia / corredor). */
const BASE_ROUTE_COLOR = '#475569';
const BASE_ROUTE_WIDTH = 4;

function getRegion(points: Point[]): Region {
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
  snapToRoute = false,
  extraStops = [],
  onExtraStopsChange,
  maxExtraStops = 3,
  driverStops = [],
  existingPickups = [],
  existingDropoffs = [],
  height = 320,
  resolvedPassengerRoute,
}: Props) {
  const hasExtras = typeof onExtraStopsChange === 'function';
  const [mode, setMode] = useState<'pickup' | 'dropoff' | 'extra'>('pickup');
  const [tapHint, setTapHint] = useState<string | null>(null);
  const [fullVisible, setFullVisible] = useState(false);
  const [locationOk, setLocationOk] = useState(false);
  const [locating, setLocating] = useState(false);
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    if (!tapHint) return;
    const t = setTimeout(() => setTapHint(null), 4000);
    return () => clearTimeout(t);
  }, [tapHint]);

  useEffect(() => {
    if (!fullVisible) return;
    let cancelled = false;
    void (async () => {
      const s = await getLocationPermissionStatus();
      if (!cancelled) setLocationOk(s === 'granted');
    })();
    return () => {
      cancelled = true;
    };
  }, [fullVisible]);

  const region = useMemo(() => {
    const pts = [...baseRoute];
    if (pickup) pts.push(pickup);
    if (dropoff) pts.push(dropoff);
    extraStops.forEach((s) => pts.push({ lat: s.lat, lng: s.lng }));
    return getRegion(pts);
  }, [baseRoute, pickup, dropoff, extraStops]);

  useEffect(() => {
    if (!fullVisible) return;
    const t = setTimeout(() => {
      mapRef.current?.animateToRegion(region, 400);
    }, 120);
    return () => clearTimeout(t);
  }, [fullVisible, region.latitude, region.longitude, region.latitudeDelta, region.longitudeDelta]);

  const basePolylineCoords = useMemo(
    () => baseRoute.map((p) => ({ latitude: p.lat, longitude: p.lng })),
    [baseRoute]
  );

  const extraStopsKey = useMemo(
    () => extraStops.map((s) => `${s.lat},${s.lng},${s.order}`).join('|'),
    [extraStops]
  );

  const { headLatLng, highlightLatLng, tailLatLng, hasPassengerHighlight, usesOsrmMergedPath } = useMemo(() => {
    const toLatLng = (pts: Point[]) => pts.map((p) => ({ latitude: p.lat, longitude: p.lng }));
    if (resolvedPassengerRoute?.mid && resolvedPassengerRoute.mid.length >= 2) {
      return {
        headLatLng: toLatLng(resolvedPassengerRoute.head),
        highlightLatLng: toLatLng(resolvedPassengerRoute.mid),
        tailLatLng: toLatLng(resolvedPassengerRoute.tail),
        hasPassengerHighlight: true,
        usesOsrmMergedPath: true,
      };
    }
    if (baseRoute.length < 2 || !pickup || !dropoff) {
      return {
        headLatLng: [] as { latitude: number; longitude: number }[],
        highlightLatLng: [] as { latitude: number; longitude: number }[],
        tailLatLng: [] as { latitude: number; longitude: number }[],
        hasPassengerHighlight: false,
        usesOsrmMergedPath: false,
      };
    }
    const tPu = getPositionAlongPolyline(pickup, baseRoute);
    const tDo = getPositionAlongPolyline(dropoff, baseRoute);
    const tLo = Math.min(tPu, tDo);
    const tHi = Math.max(tPu, tDo);
    const head = tLo > 0.002 ? slicePolylineBetweenT(baseRoute, 0, tLo) : [];
    const extrasPts = extraStops.map((s) => ({ lat: s.lat, lng: s.lng }));
    const body = passengerSegmentAlongBaseRoute(baseRoute, pickup, dropoff, extrasPts);
    const tail = tHi < 0.998 ? slicePolylineBetweenT(baseRoute, tHi, 1) : [];
    const hasPassengerHighlight = body.length >= 2;
    return {
      headLatLng: toLatLng(head),
      highlightLatLng: toLatLng(body),
      tailLatLng: toLatLng(tail),
      hasPassengerHighlight,
      usesOsrmMergedPath: false,
    };
  }, [baseRoute, pickup, dropoff, extraStopsKey, resolvedPassengerRoute]);

  const sortedDriver = useMemo(
    () =>
      [...driverStops]
        .filter((s) => s.lat != null && s.lng != null)
        .sort((a, b) => (a.stop_order ?? 0) - (b.stop_order ?? 0)),
    [driverStops]
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
    const raw: Point = { lat: latitude, lng: longitude };
    if (!validateCorridor(raw)) return;
    let p = raw;
    if (snapToRoute && baseRoute.length >= 2) {
      p = snapToPolyline(raw, baseRoute);
    }

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

  const removeLastExtra = () => {
    if (!onExtraStopsChange || extraStops.length === 0) return;
    const next = extraStops.slice(0, -1).map((s, i) => ({ ...s, order: i + 1 }));
    onExtraStopsChange(next);
  };

  const openFull = useCallback((nextMode?: typeof mode) => {
    if (nextMode) setMode(nextMode);
    setFullVisible(true);
  }, []);

  const goToMyLocation = useCallback(async () => {
    setLocating(true);
    try {
      let ok = locationOk;
      if (!ok) {
        ok = await requestLocationPermission();
        setLocationOk(ok);
      }
      if (!ok) {
        Alert.alert('Ubicación', 'Necesitamos permiso de ubicación para mostrar tu posición en el mapa.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude, longitude } = pos.coords;
      const next: Region = {
        latitude,
        longitude,
        latitudeDelta: Math.max(region.latitudeDelta, 0.04),
        longitudeDelta: Math.max(region.longitudeDelta, 0.04),
      };
      mapRef.current?.animateToRegion(next, 450);
    } catch {
      Alert.alert('Ubicación', 'No se pudo obtener tu posición. Revisá que el GPS esté activo.');
    } finally {
      setLocating(false);
    }
  }, [locationOk, region.latitudeDelta, region.longitudeDelta]);

  const mapChildren = (
    <>
      {!hasPassengerHighlight && basePolylineCoords.length >= 2 && (
        <Polyline
          coordinates={basePolylineCoords}
          strokeColor={BASE_ROUTE_COLOR}
          strokeWidth={BASE_ROUTE_WIDTH}
        />
      )}
      {hasPassengerHighlight && (
        <>
          {headLatLng.length >= 2 && (
            <Polyline
              coordinates={headLatLng}
              strokeColor={BASE_ROUTE_COLOR}
              strokeWidth={BASE_ROUTE_WIDTH}
            />
          )}
          {highlightLatLng.length >= 2 && (
            <Polyline
              coordinates={highlightLatLng}
              strokeColor={GREEN}
              strokeWidth={BASE_ROUTE_WIDTH}
            />
          )}
          {tailLatLng.length >= 2 && (
            <Polyline
              coordinates={tailLatLng}
              strokeColor={BASE_ROUTE_COLOR}
              strokeWidth={BASE_ROUTE_WIDTH}
            />
          )}
        </>
      )}
      {sortedDriver.map((s, i) => {
        const last = i === sortedDriver.length - 1;
        return (
          <Marker
            key={`d-${i}-${s.lat}`}
            coordinate={{ latitude: s.lat, longitude: s.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={Platform.OS === 'android'}
            title={i === 0 ? 'Salida (conductor)' : last ? 'Llegada (conductor)' : `Parada ${i + 1}`}
            description={s.label ?? undefined}
          >
            <View style={styles.driverDot} collapsable={false} />
          </Marker>
        );
      })}
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
    </>
  );

  if (baseRoute.length < 2) {
    return (
      <View style={styles.emptyBox}>
        <Text style={styles.emptyText}>No hay ruta para mostrar en el mapa.</Text>
      </View>
    );
  }

  const corridorM =
    maxDeviationMeters != null && maxDeviationMeters > 0 ? Math.round(maxDeviationMeters) : null;
  const modalHintLines =
    (corridorM != null
      ? `Podés tocar hasta unos ${corridorM} m de la ruta gris del conductor. `
      : 'Tocá el mapa para colocar el punto. ') +
    (hasPassengerHighlight
      ? usesOsrmMergedPath
        ? 'Gris: ruta publicada del conductor. Verde: tu tramo por calles (OSRM) que pasa por A, paradas y B y se conecta de nuevo a la ruta del conductor. '
        : 'El tramo entre A y B sigue la línea publicada del conductor en verde (si falla OSRM se usa este recorte). '
      : 'Cuando marques A y B, verás tu tramo en verde y el resto en gris. ') +
    'El botón de ubicación centra el mapa en vos.';

  const legendText = hasPassengerHighlight
    ? usesOsrmMergedPath
      ? 'Gris: conductor · Verde: OSRM por A→paradas→B conectado a la ruta · Gris: paradas del conductor'
      : 'Gris: ruta publicada; verde: tu tramo sobre esa línea · Paradas del conductor en gris'
    : 'Gris: ruta del conductor y sus paradas · Marcá A/B cerca del corredor';

  const modeRow = (
    <View style={styles.modeRow}>
      <TouchableOpacity
        style={[styles.modeBtn, mode === 'pickup' && styles.modeBtnActive]}
        onPress={() => openFull('pickup')}
      >
        <Text style={[styles.modeBtnText, mode === 'pickup' && styles.modeBtnTextActive]}>A · Subida</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.modeBtn, mode === 'dropoff' && styles.modeBtnActive]}
        onPress={() => openFull('dropoff')}
      >
        <Text style={[styles.modeBtnText, mode === 'dropoff' && styles.modeBtnTextActive]}>B · Bajada</Text>
      </TouchableOpacity>
      {hasExtras && pickup && dropoff ? (
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'extra' && styles.modeBtnActive]}
          onPress={() => openFull('extra')}
        >
          <Text style={[styles.modeBtnText, mode === 'extra' && styles.modeBtnTextActive]}>
            + Parada ({extraStops.length}/{maxExtraStops})
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  return (
    <View>
      {modeRow}
      <Text style={styles.modeHint}>
        {mode === 'pickup' && 'Tocá “A · Subida” o el mapa para abrir pantalla completa y marcar subida (A).'}
        {mode === 'dropoff' && 'Tocá “B · Bajada” o el mapa para marcar bajada (B).'}
        {mode === 'extra' && hasExtras && 'Tocá + Parada o el mapa para agregar una parada intermedia (máx. 3).'}
      </Text>
      {tapHint ? <Text style={styles.warnHint}>{tapHint}</Text> : null}
      <Text style={styles.legend}>{legendText}</Text>

      <View style={[styles.previewShell, { height }]}>
        <MapView
          provider={androidMapProvider}
          style={StyleSheet.absoluteFill}
          initialRegion={region}
          pointerEvents="none"
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
        >
          {mapChildren}
        </MapView>
        <Pressable style={styles.previewTap} onPress={() => openFull()} accessibilityRole="button" accessibilityLabel="Abrir mapa en pantalla completa" />
        <View style={styles.previewChip} pointerEvents="none">
          <Ionicons name="expand" size={14} color="#fff" style={{ marginRight: 6 }} />
          <Text style={styles.previewChipText}>Pantalla completa</Text>
        </View>
      </View>

      {hasExtras && extraStops.length > 0 ? (
        <TouchableOpacity style={styles.removeExtraBtn} onPress={removeLastExtra}>
          <Text style={styles.removeExtraText}>Quitar última parada intermedia</Text>
        </TouchableOpacity>
      ) : null}

      <Modal visible={fullVisible} animationType="slide" onRequestClose={() => setFullVisible(false)} statusBarTranslucent>
        <StatusBar barStyle="dark-content" />
        <SafeAreaView style={styles.modalSafe} edges={['top', 'left', 'right']}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setFullVisible(false)} hitSlop={12}>
              <Text style={styles.modalHeaderBtn}>Listo</Text>
            </TouchableOpacity>
            <Text style={styles.modalHeaderTitle} numberOfLines={1}>
              Tu tramo en la ruta
            </Text>
            <View style={styles.modalHeaderSpacer} />
          </View>
          <Text style={styles.modalHint}>{modalHintLines}</Text>
          {tapHint ? <Text style={styles.warnHint}>{tapHint}</Text> : null}

          <View style={styles.modalMapWrap}>
            <MapView
              ref={mapRef}
              provider={androidMapProvider}
              style={styles.modalMap}
              initialRegion={region}
              onPress={onMapPress}
              scrollEnabled
              zoomEnabled
              rotateEnabled={false}
              pitchEnabled={false}
              showsUserLocation={locationOk}
              showsMyLocationButton={false}
            >
              {mapChildren}
            </MapView>
            <TouchableOpacity
              style={styles.locateBtn}
              onPress={() => void goToMyLocation()}
              disabled={locating}
              accessibilityRole="button"
              accessibilityLabel="Ir a mi ubicación"
            >
              <Ionicons name="locate" size={26} color={GREEN} />
            </TouchableOpacity>
          </View>

          <SafeAreaView edges={['bottom']} style={styles.modalFooter}>
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
          </SafeAreaView>
        </SafeAreaView>
      </Modal>
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
  legend: { fontSize: 12, color: '#64748b', marginBottom: 8, lineHeight: 17 },
  previewShell: {
    width: '100%',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#e5e7eb',
    position: 'relative',
  },
  previewTap: { ...StyleSheet.absoluteFillObject },
  previewChip: {
    position: 'absolute',
    bottom: 10,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(22,101,52,0.92)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  previewChipText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  removeExtraBtn: { marginTop: 8, alignSelf: 'flex-start' },
  removeExtraText: { fontSize: 13, color: '#2563eb', fontWeight: '600' },
  modalSafe: { flex: 1, backgroundColor: '#fff' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  modalHeaderBtn: { fontSize: 17, fontWeight: '600', color: GREEN, minWidth: 48 },
  modalHeaderTitle: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '600', color: '#111' },
  modalHeaderSpacer: { minWidth: 48 },
  modalHint: {
    fontSize: 13,
    color: '#6b7280',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#f9fafb',
  },
  modalMapWrap: { flex: 1, position: 'relative' },
  modalMap: { ...StyleSheet.absoluteFillObject },
  locateBtn: {
    position: 'absolute',
    right: 14,
    bottom: 18,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.12,
        shadowRadius: 3,
      },
      android: { elevation: 4 },
    }),
  },
  modalFooter: {
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
    paddingTop: 4,
    paddingBottom: Platform.OS === 'ios' ? 2 : 8,
  },
  driverDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: BASE_ROUTE_COLOR,
    borderWidth: 2,
    borderColor: '#fff',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.22,
        shadowRadius: 2,
        shadowOffset: { width: 0, height: 1 },
      },
      android: { elevation: 3 },
    }),
  },
});
