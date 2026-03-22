import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<MainStackParamList, 'PublishRide'>;
type Route = RouteProp<MainStackParamList, 'PublishRide'>;

/**
 * Implementación mínima para que la navegación no falle.
 * La pantalla completa de publicar (ruta + mapa + publish) se puede integrar luego.
 */
export function PublishRideScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const params = (route.params ?? {}) as MainStackParamList['PublishRide'];

  const tripRequestId = (params as any)?.tripRequestId as string | undefined;
  const fromRideId = (params as any)?.fromRideId as string | undefined;
  const groupId = (params as any)?.groupId as string | undefined;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Publicar viaje</Text>
      <Text style={styles.subtitle}>Parámetros:</Text>
      <Text style={styles.text}>tripRequestId: {tripRequestId ?? '—'}</Text>
      <Text style={styles.text}>fromRideId: {fromRideId ?? '—'}</Text>
      <Text style={styles.text}>groupId: {groupId ?? '—'}</Text>

      <TouchableOpacity style={styles.btn} onPress={() => navigation.goBack()}>
        <Text style={styles.btnText}>Volver</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  title: { fontSize: 22, fontWeight: '700', color: '#166534', marginBottom: 12 },
  subtitle: { fontSize: 14, color: '#6b7280', marginBottom: 6 },
  text: { fontSize: 14, color: '#111', marginBottom: 4 },
  btn: { marginTop: 16, backgroundColor: '#166534', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});

