/**
 * Home base: welcome, role banners (driver_pending, admin), short links.
 * Flavor conductor: acceso rápido a Solicitudes de viaje desde Inicio; pestaña Conductor = hub publicar/solicitudes.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useAuth } from '../auth/AuthContext';
import type { MainTabParamList } from '../navigation/types';
import { getAppFlavor } from '../core/flavor';

type HomeTabNav = BottomTabNavigationProp<MainTabParamList, 'Home'>;

export function HomeScreen() {
  const navigation = useNavigation<HomeTabNav>();
  const { session } = useAuth();
  const firstName = session?.full_name?.trim()?.split(/\s+/)[0];
  const role = session?.role;
  const flavor = getAppFlavor();
  const isPassengerFlavor = flavor !== 'driver';
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
            ? 'Tocá Solicitudes para ver pedidos de pasajeros y rutas con demanda. En la pestaña Conductor podés publicar un viaje. Con Mis viajes publicados revisá lo que ya publicaste.'
            : 'En la pestaña Pasajero podés unirte a rutas con demanda. En Viajes disponibles podés buscar por el nombre de la ruta (por ejemplo una línea que la gente ya conoce). Si no aparece lo que necesitás, guardá el trayecto desde Buscar viajes o Mis solicitudes.'}
        </Text>
        {isPassengerFlavor ? (
          <TouchableOpacity
            style={styles.linkBtnEnCurso}
            onPress={() => parentNav?.navigate('NearbyEnRouteRides')}
            accessibilityRole="button"
            accessibilityLabel="Ver viajes en curso cerca de tu ubicación"
          >
            <Text style={styles.linkBtnEnCursoText}>En curso cerca</Text>
          </TouchableOpacity>
        ) : null}
        {isPassengerFlavor ? (
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
        {isPassengerFlavor && session ? (
          <TouchableOpacity
            style={styles.linkBtnReservas}
            onPress={() => parentNav?.navigate('MyBookings')}
            accessibilityRole="button"
            accessibilityLabel="Mis reservas"
          >
            <Text style={styles.linkBtnReservasText}>Mis reservas</Text>
          </TouchableOpacity>
        ) : null}
        {flavor === 'driver' ? (
          <View style={styles.links}>
            <TouchableOpacity
              style={styles.linkBtn}
              onPress={() => parentNav?.navigate('DriverTripRequests')}
              accessibilityRole="button"
              accessibilityLabel="Solicitudes de viaje"
            >
              <Text style={styles.linkBtnText}>Solicitudes</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.linkBtn} onPress={() => parentNav?.navigate('Messages')}>
              <Text style={styles.linkBtnText}>Mensajes</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.links}>
            <TouchableOpacity style={styles.linkBtn} onPress={() => parentNav?.navigate('Messages')}>
              <Text style={styles.linkBtnText}>Mensajes</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.linkBtn} onPress={() => parentNav?.navigate('MyTripRequests')}>
              <Text style={styles.linkBtnText}>Mis solicitudes</Text>
            </TouchableOpacity>
          </View>
        )}
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
  passengerRideActions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  linkBtnEnCurso: {
    marginTop: 14,
    minHeight: 48,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#1d4ed8',
    alignItems: 'center',
  },
  linkBtnEnCursoText: { color: '#fff', fontSize: 14, fontWeight: '700' },
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
