/**
 * Home base: welcome, role banners (driver_pending, admin), short links (Mensajes, Viajes a oferta).
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import type { MainStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<MainStackParamList, 'MainTabs'>;

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const { session } = useAuth();
  const name = session?.full_name ?? session?.email ?? 'Usuario';
  const role = session?.role;
  const parentNav = navigation.getParent() as { navigate: (a: string, b?: object) => void } | undefined;

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        {role === 'driver_pending' && (
          <View style={styles.bannerWarning}>
            <Text style={styles.bannerText}>Tu cuenta de conductor está en revisión. Cuando sea aprobada podrás publicar viajes.</Text>
          </View>
        )}
        {role === 'admin' && (
          <View style={styles.bannerInfo}>
            <Text style={styles.bannerText}>Para administrar precios, facturación y métricas usá el panel web.</Text>
          </View>
        )}
        <Text style={styles.welcome}>Hola, {name}</Text>
        <Text style={styles.hint}>Usá las pestañas Conductor o Pasajero para viajes y reservas.</Text>
        <View style={styles.links}>
          <TouchableOpacity style={styles.linkBtn} onPress={() => parentNav?.navigate('Messages')}>
            <Text style={styles.linkBtnText}>Mensajes</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.linkBtn} onPress={() => parentNav?.navigate('Offer')}>
            <Text style={styles.linkBtnText}>Viajes a oferta</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f0fdf4',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  welcome: {
    fontSize: 24,
    fontWeight: '700',
    color: '#14532d',
    marginBottom: 10,
  },
  hint: {
    fontSize: 16,
    color: '#4b5563',
    lineHeight: 22,
  },
  bannerWarning: {
    backgroundColor: '#fef3c7',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#f59e0b',
  },
  bannerInfo: {
    backgroundColor: '#dbeafe',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  bannerText: { fontSize: 14, color: '#1f2937' },
  links: { flexDirection: 'row', gap: 12, marginTop: 20 },
  linkBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: '#166534', alignItems: 'center' },
  linkBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
