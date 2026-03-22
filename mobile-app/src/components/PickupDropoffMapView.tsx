/**
 * Mapa para elegir subida (A) y bajada (B) sobre un corredor (polyline).
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import MapView, { Polyline, Marker, type MapPressEvent } from 'react-native-maps';
import type { Point } from '../lib/geo';

export type MapPoint = Point | null;

type Props = {
  baseRoute: Point[];
  pickup: MapPoint;
  dropoff: MapPoint;
  onPickupChange: (p: MapPoint) => void;
  onDropoffChange: (p: MapPoint) => void;
  height?: number;
};

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

export function PickupDropoffMapView({
  baseRoute,
  pickup,
  dropoff,
  onPickupChange,
  onDropoffChange,
  height = 320,
}: Props) {
  const [mode, setMode] = useState<'pickup' | 'dropoff'>('pickup');

  const region = useMemo(() => {
    const pts = [...baseRoute];
    if (pickup) pts.push(pickup);
    if (dropoff) pts.push(dropoff);
    return getRegion(pts);
  }, [baseRoute, pickup, dropoff]);

  const polylineCoords = useMemo(
    () => baseRoute.map((p) => ({ latitude: p.lat, longitude: p.lng })),
    [baseRoute]
  );

  const onMapPress = (e: MapPressEvent) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    const p: Point = { lat: latitude, lng: longitude };
    if (mode === 'pickup') {
      onPickupChange(p);
    } else {
      onDropoffChange(p);
    }
  };

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
      </View>
      <Text style={styles.modeHint}>
        Tocá el mapa para colocar el punto {mode === 'pickup' ? 'de subida (A)' : 'de bajada (B)'}.
      </Text>
      <MapView style={[styles.map, { height }]} initialRegion={region} onPress={onMapPress} scrollEnabled zoomEnabled>
        {polylineCoords.length >= 2 && (
          <Polyline coordinates={polylineCoords} strokeColor="#166534" strokeWidth={4} />
        )}
        {pickup && (
          <Marker coordinate={{ latitude: pickup.lat, longitude: pickup.lng }} title="Subida (A)" pinColor="green" />
        )}
        {dropoff && (
          <Marker coordinate={{ latitude: dropoff.lat, longitude: dropoff.lng }} title="Bajada (B)" pinColor="red" />
        )}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
  },
  modeBtnActive: { backgroundColor: '#166534' },
  modeBtnText: { fontSize: 14, fontWeight: '600', color: '#374151' },
  modeBtnTextActive: { color: '#fff' },
  modeHint: { fontSize: 13, color: '#6b7280', marginBottom: 8 },
  map: { width: '100%', borderRadius: 12 },
});
