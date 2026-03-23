/**
 * Mapa para “Buscar viajes”: vista previa → pantalla completa con mapa interactivo y botones de modo.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Alert,
  Modal,
  StatusBar,
  Pressable,
} from 'react-native';
import MapView, { Marker, Polyline, type MapPressEvent, type Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { androidMapProvider } from '../lib/androidMapProvider';
import { reverseGeocodeStructured } from '../backend/geocodeApi';
import { fetchRoute } from '../backend/routeApi';
import type { Point } from '../lib/geo';
import { getLocationPermissionStatus, requestLocationPermission } from '../permissions';

const GREEN = '#166534';

const DEFAULT_REGION: Region = {
  latitude: -25.286,
  longitude: -57.647,
  latitudeDelta: 0.25,
  longitudeDelta: 0.25,
};

function shortenLabel(s: string, max = 140): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function regionFromPoints(a: Point | null, b: Point | null): Region {
  const pts = [a, b].filter((p): p is Point => p != null);
  if (pts.length === 0) return DEFAULT_REGION;
  if (pts.length === 1) {
    return {
      latitude: pts[0].lat,
      longitude: pts[0].lng,
      latitudeDelta: 0.08,
      longitudeDelta: 0.08,
    };
  }
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  const pad = 0.02;
  return {
    latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
    longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    latitudeDelta: Math.max(0.06, Math.max(...lats) - Math.min(...lats) + pad * 2),
    longitudeDelta: Math.max(0.06, Math.max(...lngs) - Math.min(...lngs) + pad * 2),
  };
}

type Props = {
  origin: Point | null;
  destination: Point | null;
  onOriginChange: (p: Point | null) => void;
  onDestinationChange: (p: Point | null) => void;
  onOriginLabelResolved?: (label: string) => void;
  onDestinationLabelResolved?: (label: string) => void;
  height?: number;
};

function ModeChipRow(props: {
  mode: 'origin' | 'destination';
  onSelectOrigin: () => void;
  onSelectDestination: () => void;
  variant: 'compact' | 'footer';
}) {
  const { mode, onSelectOrigin, onSelectDestination, variant } = props;
  const chipStyle = variant === 'footer' ? styles.modeBtn : styles.modeChip;
  const chipActive = variant === 'footer' ? styles.modeBtnActive : styles.modeChipActive;
  const textStyle = variant === 'footer' ? styles.modeBtnText : styles.modeChipText;
  const textActive = variant === 'footer' ? styles.modeBtnTextActive : styles.modeChipTextActive;
  return (
    <View style={styles.modeRow}>
      <TouchableOpacity
        style={[chipStyle, mode === 'origin' && chipActive]}
        onPress={onSelectOrigin}
        accessibilityRole="button"
        accessibilityState={{ selected: mode === 'origin' }}
      >
        <Text style={[textStyle, mode === 'origin' && textActive]}>Marcar origen</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[chipStyle, mode === 'destination' && chipActive]}
        onPress={onSelectDestination}
        accessibilityRole="button"
        accessibilityState={{ selected: mode === 'destination' }}
      >
        <Text style={[textStyle, mode === 'destination' && textActive]}>Marcar destino</Text>
      </TouchableOpacity>
    </View>
  );
}

export function SearchOriginDestinationMap({
  origin,
  destination,
  onOriginChange,
  onDestinationChange,
  onOriginLabelResolved,
  onDestinationLabelResolved,
  height = 220,
}: Props) {
  const mapRef = useRef<MapView>(null);
  const [mode, setMode] = useState<'origin' | 'destination'>('origin');
  const [fullVisible, setFullVisible] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationOk, setLocationOk] = useState(false);
  /** Ruta por calles (OSRM) entre origen y destino; vacío = fallback a línea recta. */
  const [osrmLine, setOsrmLine] = useState<Point[]>([]);
  const [routeLoading, setRouteLoading] = useState(false);

  const region = useMemo(() => regionFromPoints(origin, destination), [origin, destination]);

  const lineCoords = useMemo(() => {
    if (!origin || !destination) return [];
    return [
      { latitude: origin.lat, longitude: origin.lng },
      { latitude: destination.lat, longitude: destination.lng },
    ];
  }, [origin, destination]);

  useEffect(() => {
    if (!origin || !destination) {
      setOsrmLine([]);
      setRouteLoading(false);
      return;
    }
    let cancelled = false;
    setRouteLoading(true);
    setOsrmLine([]);
    void fetchRoute(origin, destination, []).then((r) => {
      if (cancelled) return;
      if (r.polyline && r.polyline.length >= 2) {
        setOsrmLine(r.polyline.map((p) => ({ lat: p.lat, lng: p.lng })));
      } else {
        setOsrmLine([]);
      }
      setRouteLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [origin?.lat, origin?.lng, destination?.lat, destination?.lng]);

  const osrmCoords = useMemo(
    () => osrmLine.map((p) => ({ latitude: p.lat, longitude: p.lng })),
    [osrmLine]
  );

  useEffect(() => {
    if (!fullVisible) return;
    const coords: { latitude: number; longitude: number }[] = [];
    if (osrmCoords.length >= 2) {
      coords.push(...osrmCoords);
    } else if (lineCoords.length >= 2) {
      coords.push(...lineCoords);
    }
    if (coords.length < 2) return;
    const t = setTimeout(() => {
      mapRef.current?.fitToCoordinates(coords, {
        edgePadding: { top: 100, right: 36, bottom: 180, left: 36 },
        animated: true,
      });
    }, 400);
    return () => clearTimeout(t);
  }, [fullVisible, osrmCoords, lineCoords]);

  const openFull = useCallback((nextMode?: 'origin' | 'destination') => {
    if (nextMode) setMode(nextMode);
    setFullVisible(true);
  }, []);

  const onMapPress = useCallback(
    async (e: MapPressEvent) => {
      const { latitude, longitude } = e.nativeEvent.coordinate;
      const p: Point = { lat: latitude, lng: longitude };
      setGeocoding(true);
      try {
        const r = await reverseGeocodeStructured(latitude, longitude);
        const label = shortenLabel(r.displayName);
        if (mode === 'origin') {
          onOriginChange(p);
          onOriginLabelResolved?.(label);
        } else {
          onDestinationChange(p);
          onDestinationLabelResolved?.(label);
        }
      } finally {
        setGeocoding(false);
      }
    },
    [mode, onOriginChange, onDestinationChange, onOriginLabelResolved, onDestinationLabelResolved]
  );

  const goToMyLocation = useCallback(async () => {
    setLocating(true);
    try {
      let ok = locationOk;
      if (!ok) {
        const status = await getLocationPermissionStatus();
        ok = status === 'granted';
        if (!ok) ok = await requestLocationPermission();
        setLocationOk(ok);
      }
      if (!ok) {
        Alert.alert('Ubicación', 'Necesitamos permiso para centrar el mapa en tu posición.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = pos.coords;
      setLocationOk(true);
      mapRef.current?.animateToRegion(
        {
          latitude,
          longitude,
          latitudeDelta: Math.max(region.latitudeDelta, 0.06),
          longitudeDelta: Math.max(region.longitudeDelta, 0.06),
        },
        450
      );
    } catch {
      Alert.alert('Ubicación', 'No se pudo obtener tu posición.');
    } finally {
      setLocating(false);
    }
  }, [locationOk, region.latitudeDelta, region.longitudeDelta]);

  const mapChildren = (
    <>
      {osrmCoords.length >= 2 ? (
        <Polyline coordinates={osrmCoords} strokeColor={GREEN} strokeWidth={4} />
      ) : lineCoords.length >= 2 ? (
        <Polyline coordinates={lineCoords} strokeColor="#94a3b8" strokeWidth={3} />
      ) : null}
      {origin ? (
        <Marker
          coordinate={{ latitude: origin.lat, longitude: origin.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={Platform.OS === 'android'}
        >
          <View style={[styles.dot, styles.dotOrigin]} collapsable={false} />
        </Marker>
      ) : null}
      {destination ? (
        <Marker
          coordinate={{ latitude: destination.lat, longitude: destination.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={Platform.OS === 'android'}
        >
          <View style={[styles.dot, styles.dotDest]} collapsable={false} />
        </Marker>
      ) : null}
    </>
  );

  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return null;
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.sectionLabel}>Mapa (opcional)</Text>
      <Text style={styles.hint}>
        Tocá un botón de modo o el mapa para abrir pantalla completa. Ahí tocás el mapa para fijar origen o destino
        (≈22 km de filtro). Podés usar solo texto arriba si preferís.
      </Text>

      <ModeChipRow
        mode={mode}
        variant="compact"
        onSelectOrigin={() => openFull('origin')}
        onSelectDestination={() => openFull('destination')}
      />
      <Text style={styles.modeHint}>
        {mode === 'origin' && 'Modo: origen — se abre el mapa grande para marcar.'}
        {mode === 'destination' && 'Modo: destino — se abre el mapa grande para marcar.'}
      </Text>

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
        <Pressable
          style={styles.previewTap}
          onPress={() => openFull()}
          accessibilityRole="button"
          accessibilityLabel="Abrir mapa en pantalla completa"
        />
        <View style={styles.previewChip} pointerEvents="none">
          <Ionicons name="expand" size={14} color="#fff" style={{ marginRight: 6 }} />
          <Text style={styles.previewChipText}>Pantalla completa</Text>
        </View>
        {routeLoading && origin && destination ? (
          <View style={styles.previewRouteLoading} pointerEvents="none">
            <ActivityIndicator size="small" color="#fff" />
          </View>
        ) : null}
      </View>

      <View style={styles.clearRow}>
        {origin ? (
          <TouchableOpacity onPress={() => onOriginChange(null)} accessibilityRole="button">
            <Text style={styles.clearLink}>Quitar origen del mapa</Text>
          </TouchableOpacity>
        ) : null}
        {destination ? (
          <TouchableOpacity onPress={() => onDestinationChange(null)} accessibilityRole="button">
            <Text style={styles.clearLink}>Quitar destino del mapa</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <Modal visible={fullVisible} animationType="slide" onRequestClose={() => setFullVisible(false)} statusBarTranslucent>
        <StatusBar barStyle="dark-content" />
        <SafeAreaView style={styles.modalSafe} edges={['top', 'left', 'right']}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setFullVisible(false)} hitSlop={12} accessibilityRole="button">
              <Text style={styles.modalHeaderBtn}>Listo</Text>
            </TouchableOpacity>
            <Text style={styles.modalHeaderTitle} numberOfLines={1}>
              Origen y destino en el mapa
            </Text>
            <View style={styles.modalHeaderSpacer} />
          </View>

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
              {locating ? <ActivityIndicator color={GREEN} /> : <Ionicons name="locate" size={26} color={GREEN} />}
            </TouchableOpacity>
            {geocoding ? (
              <View style={styles.geoOverlay} pointerEvents="none">
                <ActivityIndicator size="large" color={GREEN} />
              </View>
            ) : null}
            {routeLoading && !geocoding ? (
              <View style={styles.routeLoadingCorner} pointerEvents="none">
                <ActivityIndicator size="small" color={GREEN} />
                <Text style={styles.routeLoadingCornerText}>Ruta…</Text>
              </View>
            ) : null}
          </View>

          <SafeAreaView edges={['bottom']} style={styles.modalFooter}>
            <ModeChipRow
              mode={mode}
              variant="footer"
              onSelectOrigin={() => setMode('origin')}
              onSelectDestination={() => setMode('destination')}
            />
            <View style={styles.modalClearRow}>
              {origin ? (
                <TouchableOpacity onPress={() => onOriginChange(null)} accessibilityRole="button">
                  <Text style={styles.clearLink}>Quitar origen</Text>
                </TouchableOpacity>
              ) : null}
              {destination ? (
                <TouchableOpacity onPress={() => onDestinationChange(null)} accessibilityRole="button">
                  <Text style={styles.clearLink}>Quitar destino</Text>
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
  wrap: { marginBottom: 4 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 4,
  },
  hint: { fontSize: 12, color: '#6b7280', lineHeight: 17, marginBottom: 10 },
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  modeChip: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: '#fff',
    flexGrow: 1,
    minWidth: '42%',
    alignItems: 'center',
  },
  modeChipActive: { borderColor: GREEN, backgroundColor: '#f0fdf4' },
  modeChipText: { fontSize: 13, fontWeight: '600', color: '#374151' },
  modeChipTextActive: { color: GREEN },
  modeBtn: {
    flexGrow: 1,
    minWidth: '42%',
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
  },
  modeBtnActive: { backgroundColor: GREEN },
  modeBtnText: { fontSize: 13, fontWeight: '600', color: '#374151' },
  modeBtnTextActive: { color: '#fff' },
  modeHint: { fontSize: 13, color: '#6b7280', marginBottom: 8 },
  previewShell: {
    width: '100%',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#e5e7eb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
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
  previewRouteLoading: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(22,101,52,0.9)',
    borderRadius: 20,
    padding: 8,
  },
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
  geoOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  routeLoadingCorner: {
    position: 'absolute',
    left: 12,
    top: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  routeLoadingCornerText: { fontSize: 12, fontWeight: '600', color: GREEN },
  modalFooter: {
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 4 : 10,
    paddingHorizontal: 8,
  },
  modalClearRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#fff',
  },
  dotOrigin: { backgroundColor: '#15803d' },
  dotDest: { backgroundColor: '#b91c1c' },
  clearRow: { marginTop: 8, gap: 6 },
  clearLink: { fontSize: 13, color: GREEN, fontWeight: '600' },
});
