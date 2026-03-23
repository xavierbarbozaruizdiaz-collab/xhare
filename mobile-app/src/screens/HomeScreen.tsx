/**
 * Home base: welcome, role banners (driver_pending, admin), short links (Mensajes, Viajes a oferta).
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import type { MainStackParamList } from '../navigation/types';
import { getAppFlavor } from '../core/flavor';

type Nav = NativeStackNavigationProp<MainStackParamList, 'MainTabs'>;

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const { session } = useAuth();
  const firstName = session?.full_name?.trim()?.split(/\s+/)[0];
  const role = session?.role;
  const flavor = getAppFlavor();
  const parentNav = navigation.getParent() as { navigate: (a: string, b?: object) => void } | undefined;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
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
        <Text style={styles.welcome}>{firstName ? `Hola, ${firstName}` : 'Hola'}</Text>
        {session?.email && !firstName ? <Text style={styles.emailHint}>{session.email}</Text> : null}
        <Text style={styles.hint}>
          {flavor === 'driver'
            ? 'En la pestaña Conductor tenés solicitudes y el botón Mis viajes publicados para ver lo que publicaste.'
            : 'En Pasajero podés unirte a rutas con demanda. Para viajes ya publicados: Viajes disponibles (lista de hoy) o Buscar viajes (fecha, origen y destino).'}
        </Text>
        {flavor !== 'driver' ? (
          <View style={styles.passengerRideActions}>
            <TouchableOpacity
              style={styles.linkBtnOutline}
              onPress={() => parentNav?.navigate('SearchPublishedRides')}
              accessibilityRole="button"
              accessibilityLabel="Buscar viajes con filtros"
            >
              <Text style={styles.linkBtnOutlineText}>Buscar viajes</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.linkBtnSolidHalf}
              onPress={() => parentNav?.navigate('AvailableRides')}
              accessibilityRole="button"
              accessibilityLabel="Ver viajes disponibles publicados hoy"
            >
              <Text style={styles.linkBtnText}>Viajes disponibles</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {session ? (
          <TouchableOpacity
            style={styles.linkBtnReservas}
            onPress={() => parentNav?.navigate('MyBookings')}
            accessibilityRole="button"
            accessibilityLabel="Mis reservas"
          >
            <Text style={styles.linkBtnReservasText}>Mis reservas</Text>
          </TouchableOpacity>
        ) : null}
        <View style={styles.links}>
          <TouchableOpacity style={styles.linkBtn} onPress={() => parentNav?.navigate('Messages')}>
            <Text style={styles.linkBtnText}>Mensajes</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.linkBtn} onPress={() => parentNav?.navigate('Offer')}>
            <Text style={styles.linkBtnText}>Viajes a oferta</Text>
          </TouchableOpacity>
        </View>
        {flavor === 'driver' ? (
          <TouchableOpacity
            style={styles.linkBtnFull}
            onPress={() => parentNav?.navigate('MyPublishedRides')}
            accessibilityRole="button"
            accessibilityLabel="Mis viajes publicados"
          >
            <Text style={styles.linkBtnText}>Mis viajes publicados</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#f0fdf4' },
  scrollContent: {
    flexGrow: 1,
    padding: 20,
    paddingBottom: 28,
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
    marginBottom: 6,
  },
  emailHint: { fontSize: 13, color: '#6b7280', marginBottom: 8 },
  hint: {
    fontSize: 16,
    color: '#4b5563',
    lineHeight: 22,
    marginBottom: 4,
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
  passengerRideActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  linkBtnOutline: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#166534',
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  linkBtnOutlineText: { color: '#166534', fontSize: 14, fontWeight: '600' },
  linkBtnSolidHalf: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#14532d',
    alignItems: 'center',
  },
  links: { flexDirection: 'row', gap: 12, marginTop: 12 },
  linkBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: '#166534', alignItems: 'center' },
  /** Visible junto a Buscar/Viajes: no queda debajo del pliegue en pantallas bajas. */
  linkBtnReservas: {
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#14532d',
    backgroundColor: '#ecfdf5',
    alignItems: 'center',
  },
  linkBtnReservasText: { color: '#14532d', fontSize: 15, fontWeight: '800' },
  linkBtnFull: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#14532d',
    alignItems: 'center',
  },
  linkBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
