import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<MainStackParamList, 'BookRide'>;
type Route = RouteProp<MainStackParamList, 'BookRide'>;

/**
 * Implementación mínima para evitar que la navegación falle.
 * (En esta iteración nos concentramos en "Solicitudes de trayecto".)
 */
export function BookRideScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const params = route.params as MainStackParamList['BookRide'];
  const rideId = (params as any)?.rideId as string | undefined;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Reservar viaje</Text>
      <Text style={styles.text}>rideId: {rideId ?? '—'}</Text>
      <TouchableOpacity style={styles.btn} onPress={() => navigation.goBack()}>
        <Text style={styles.btnText}>Volver</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  title: { fontSize: 22, fontWeight: '700', color: '#166534', marginBottom: 12 },
  text: { fontSize: 14, color: '#111', marginBottom: 4 },
  btn: { marginTop: 16, backgroundColor: '#166534', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});

