/**
 * Mapa a pantalla completa para marcar origen, destino y paradas al publicar un viaje.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  StatusBar,
  Alert,
} from 'react-native';
import MapView, { Polyline, Marker, type MapPressEvent, type Region } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { androidMapProvider } from '../lib/androidMapProvider';
import { getLocationPermissionStatus, requestLocationPermission } from '../permissions';

const GREEN = '#166534';

export type PublishMapMode = 'origin' | 'destination' | 'waypoint';

type Props = {
  visible: boolean;
  onClose: () => void;
  mapMode: PublishMapMode;
  onMapModeChange: (m: PublishMapMode) => void;
  region: Region;
  polylineCoords: Array<{ latitude: number; longitude: number }>;
  origin: { lat: number; lng: number } | null;
  destination: { lat: number; lng: number } | null;
  waypoints: Array<{ lat: number; lng: number }>;
  onMapPress: (e: MapPressEvent) => void;
  originDestinationReady: boolean;
  waypointCount: number;
  maxWaypoints?: number;
  onRemoveWaypoint: (index: number) => void;
  /** Remount del MapView cuando cambian marcadores/ruta (Android puede no pintar overlays si solo cambia `region`). */
  mapRenderKey: string;
};

export function PublishRouteMapModal({
  visible,
  onClose,
  mapMode,
  onMapModeChange,
  region,
  polylineCoords,
  origin,
  destination,
  waypoints,
  onMapPress,
  originDestinationReady,
  waypointCount,
  maxWaypoints = 3,
  onRemoveWaypoint,
  mapRenderKey,
}: Props) {
  const mapRef = useRef<MapView>(null);
  /** Tras quitar una parada con `onMarkerPress`, Android también dispara `onPress` del mapa: lo ignoramos un instante. */
  const mapPressSilenceUntilRef = useRef(0);
  const [locationOk, setLocationOk] = useState(false);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      const s = await getLocationPermissionStatus();
      if (!cancelled) setLocationOk(s === 'granted');
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

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

  const removeWpDebounceRef = useRef(0);

  const requestRemoveWaypoint = useCallback(
    (index: number) => {
      const now = Date.now();
      if (now - removeWpDebounceRef.current < 350) return;
      removeWpDebounceRef.current = now;
      mapPressSilenceUntilRef.current = now + 700;
      onRemoveWaypoint(index);
    },
    [onRemoveWaypoint]
  );

  const handleMapMarkerPress = useCallback(
    (e: { nativeEvent: { id: string } }) => {
      const prefix = 'publish-wp-';
      const id = e.nativeEvent.id;
      if (!id?.startsWith(prefix)) return;
      const idx = parseInt(id.slice(prefix.length), 10);
      if (Number.isNaN(idx)) return;
      requestRemoveWaypoint(idx);
    },
    [requestRemoveWaypoint]
  );

  const handleMapPress = useCallback(
    (ev: MapPressEvent) => {
      if (Date.now() < mapPressSilenceUntilRef.current) return;
      onMapPress(ev);
    },
    [onMapPress]
  );

  const modeLabel =
    mapMode === 'origin' ? 'Marcá el origen' : mapMode === 'destination' ? 'Marcá el destino' : 'Marcá una parada';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Text style={styles.headerBtn}>Listo</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {modeLabel}
          </Text>
          <View style={styles.headerSpacer} />
        </View>
        <Text style={styles.hint}>
          Tocá el mapa para colocar el punto. La ruta verde es OSRM (origen → paradas → destino).
          {mapMode === 'waypoint'
            ? ' Colocá la parada donde quieras (entre origen y destino). Para quitarla, tocá el pin o la etiqueta.'
            : ''}
        </Text>
        <View style={styles.mapContainer}>
          <MapView
            key={mapRenderKey}
            ref={mapRef}
            provider={androidMapProvider}
            style={styles.map}
            region={region}
            onPress={handleMapPress}
            onMarkerPress={handleMapMarkerPress}
            scrollEnabled
            zoomEnabled
            rotateEnabled
            pitchEnabled={false}
            showsUserLocation={locationOk}
            showsMyLocationButton={false}
          >
            {polylineCoords.length >= 2 && (
              <Polyline coordinates={polylineCoords} strokeColor={GREEN} strokeWidth={5} />
            )}
            {waypoints.map((w, i) => (
              <Marker
                key={`m-wp-${w.lat}-${w.lng}-${i}`}
                identifier={`publish-wp-${i}`}
                coordinate={{ latitude: w.lat, longitude: w.lng }}
                anchor={{ x: 0.5, y: 1 }}
                tracksViewChanges={Platform.OS === 'android'}
                stopPropagation
                onPress={() => requestRemoveWaypoint(i)}
              >
                <View style={styles.wpMarker} pointerEvents="box-none" collapsable={false}>
                  <View style={styles.wpChip} collapsable={false}>
                    <Text style={styles.wpChipText}>Parada {i + 1}</Text>
                    <View
                      style={styles.wpRemove}
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    >
                      <Ionicons name="close" size={15} color="#64748b" />
                    </View>
                  </View>
                  <View style={styles.wpDot} collapsable={false} />
                </View>
              </Marker>
            ))}
            {origin && (
              <Marker coordinate={{ latitude: origin.lat, longitude: origin.lng }} title="Origen" pinColor="red" />
            )}
            {destination && (
              <Marker
                coordinate={{ latitude: destination.lat, longitude: destination.lng }}
                title="Destino"
                pinColor="green"
              />
            )}
          </MapView>
          <TouchableOpacity
            style={styles.locateBtn}
            onPress={goToMyLocation}
            disabled={locating}
            accessibilityRole="button"
            accessibilityLabel="Ir a mi ubicación"
          >
            <Ionicons name="locate" size={26} color={GREEN} />
          </TouchableOpacity>
        </View>
        <SafeAreaView edges={['bottom']} style={styles.footerSafe}>
          <View style={styles.modeRow}>
            <TouchableOpacity
              style={[styles.modeBtn, mapMode === 'origin' && styles.modeBtnActive]}
              onPress={() => onMapModeChange('origin')}
            >
              <Text style={[styles.modeText, mapMode === 'origin' && styles.modeTextActive]}>Origen</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, mapMode === 'waypoint' && styles.modeBtnActive]}
              onPress={() => originDestinationReady && onMapModeChange('waypoint')}
              disabled={!originDestinationReady}
            >
              <Text
                style={[
                  styles.modeText,
                  mapMode === 'waypoint' && styles.modeTextActive,
                  !originDestinationReady && styles.modeTextDisabled,
                ]}
              >
                + Parada ({waypointCount}/{maxWaypoints})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, mapMode === 'destination' && styles.modeBtnActive]}
              onPress={() => onMapModeChange('destination')}
            >
              <Text style={[styles.modeText, mapMode === 'destination' && styles.modeTextActive]}>Destino</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  headerBtn: { fontSize: 17, fontWeight: '600', color: GREEN, minWidth: 48 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '600', color: '#111' },
  headerSpacer: { minWidth: 48 },
  hint: {
    fontSize: 13,
    color: '#6b7280',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#f9fafb',
  },
  mapContainer: { flex: 1, position: 'relative' },
  map: { ...StyleSheet.absoluteFillObject },
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
  footerSafe: { backgroundColor: '#fff', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e5e7eb' },
  modeRow: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 10,
    paddingBottom: Platform.OS === 'ios' ? 4 : 10,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
    marginHorizontal: 4,
  },
  modeBtnActive: { backgroundColor: GREEN },
  modeText: { fontSize: 13, fontWeight: '600', color: '#374151' },
  modeTextActive: { color: '#fff' },
  modeTextDisabled: { color: '#9ca3af' },
  wpMarker: { alignItems: 'center' },
  wpChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingLeft: 9,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
    marginBottom: 3,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 2,
      },
      android: { elevation: 2 },
    }),
  },
  wpChipText: { fontSize: 12, fontWeight: '700', color: '#1e40af' },
  wpRemove: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  wpDot: {
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: '#2563eb',
    borderWidth: 2,
    borderColor: '#fff',
    ...Platform.select({
      android: { elevation: 2 },
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.15,
        shadowRadius: 1,
      },
    }),
  },
});
