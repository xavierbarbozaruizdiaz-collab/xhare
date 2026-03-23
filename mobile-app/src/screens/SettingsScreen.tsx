/**
 * Settings: account, navigation preference, permissions, Mensajes, Vehículo, Mis solicitudes, sign out.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { getNavigationPreference, setNavigationPreference, type NavPreference } from '../settings';
import { requestLocationPermission, getLocationPermissionStatus } from '../permissions';
import { useEffect } from 'react';
import type { MainStackParamList } from '../navigation/types';

const NAV_OPTIONS: { value: NavPreference; label: string }[] = [
  { value: 'google_maps', label: 'Google Maps' },
  { value: 'waze', label: 'Waze' },
  { value: 'browser', label: 'Navegador' },
];

type Nav = NativeStackNavigationProp<MainStackParamList, 'MainTabs'>;

export function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const { session, signOut } = useAuth();
  const [navPref, setNavPref] = useState<NavPreference>('google_maps');
  const [locationStatus, setLocationStatus] = useState<string>('');
  const [signingOut, setSigningOut] = useState(false);
  const parentNav = navigation.getParent() as { navigate: (a: string, b?: object) => void } | undefined;

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  useEffect(() => {
    getNavigationPreference().then(setNavPref);
    getLocationPermissionStatus().then((s) =>
      setLocationStatus(s === 'granted' ? 'Concedido' : s === 'denied' ? 'Denegado' : 'No solicitado')
    );
  }, []);

  const handleRequestLocation = async () => {
    const granted = await requestLocationPermission();
    const s = await getLocationPermissionStatus();
    setLocationStatus(s === 'granted' ? 'Concedido' : s === 'denied' ? 'Denegado' : 'No solicitado');
    if (!granted) Alert.alert('Permiso', 'Se denegó el permiso de ubicación. Podés activarlo en Ajustes del dispositivo.');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {session?.email ? (
        <Text style={styles.email}>{session.email}</Text>
      ) : null}

      <Text style={styles.sectionTitle}>Navegación externa</Text>
      <Text style={styles.hint}>Al tocar "Abrir en Maps / Waze" en un viaje se usará:</Text>
      {NAV_OPTIONS.map((opt) => (
        <TouchableOpacity
          key={opt.value}
          style={[styles.radioRow, navPref === opt.value && styles.radioRowActive]}
          onPress={async () => {
            await setNavigationPreference(opt.value);
            setNavPref(opt.value);
          }}
        >
          <Text style={styles.radioLabel}>{opt.label}</Text>
          {navPref === opt.value ? <Text style={styles.radioCheck}>✓</Text> : null}
        </TouchableOpacity>
      ))}

      <Text style={styles.sectionTitle}>Permisos</Text>
      <View style={styles.permRow}>
        <Text style={styles.permLabel}>Ubicación: {locationStatus}</Text>
        <TouchableOpacity style={styles.permBtn} onPress={handleRequestLocation}>
          <Text style={styles.permBtnText}>Solicitar</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>Cuenta</Text>
      <TouchableOpacity
        style={styles.linkRow}
        onPress={() => parentNav?.navigate('Messages')}
        accessibilityLabel="Mensajes"
        accessibilityHint="Ver conversaciones y chat"
        accessibilityRole="button"
      >
        <Text style={styles.linkLabel}>Mensajes</Text>
        <Text style={styles.linkArrow}>→</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.linkRow}
        onPress={() => parentNav?.navigate('VehicleSetup')}
        accessibilityLabel="Configurar vehículo"
        accessibilityHint="Modelo, año y cantidad de asientos"
        accessibilityRole="button"
      >
        <Text style={styles.linkLabel}>Configurar vehículo</Text>
        <Text style={styles.linkArrow}>→</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.linkRow}
        onPress={() => parentNav?.navigate('MyTripRequests')}
        accessibilityLabel="Mis solicitudes de trayecto"
        accessibilityHint="Solicitudes guardadas cuando no había viajes publicados"
        accessibilityRole="button"
      >
        <Text style={styles.linkLabel}>Mis solicitudes</Text>
        <Text style={styles.linkArrow}>→</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.button, signingOut && styles.buttonDisabled]}
        onPress={handleSignOut}
        disabled={signingOut}
        accessibilityLabel="Cerrar sesión"
        accessibilityRole="button"
        accessibilityHint="Salir de la cuenta"
      >
        {signingOut ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.buttonText}>Cerrar sesión</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 24, paddingBottom: 40 },
  email: { fontSize: 14, color: '#666', marginBottom: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#111', marginTop: 16, marginBottom: 8 },
  hint: { fontSize: 13, color: '#666', marginBottom: 12 },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: '#f9fafb',
  },
  radioRowActive: { backgroundColor: '#dcfce7', borderWidth: 1, borderColor: '#166534' },
  radioLabel: { fontSize: 15, color: '#111' },
  radioCheck: { color: '#166534', fontWeight: '700' },
  permRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  permLabel: { fontSize: 14, color: '#374151' },
  permBtn: { paddingVertical: 8, paddingHorizontal: 14, backgroundColor: '#166534', borderRadius: 8 },
  permBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: '#f9fafb',
  },
  linkLabel: { fontSize: 15, color: '#111' },
  linkArrow: { fontSize: 16, color: '#6b7280' },
  buttonDisabled: { opacity: 0.7 },
  button: {
    backgroundColor: '#dc2626',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
