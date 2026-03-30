/**
 * Settings: cuenta, navegación, permisos, Mensajes; Mis solicitudes (pasajero) o Solicitudes de viaje (conductor), cerrar sesión.
 * Vehículo: solo administración web.
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
  Image,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { getNavigationPreference, setNavigationPreference, type NavPreference } from '../settings';
import { requestLocationPermission, getLocationPermissionStatus } from '../permissions';
import { useEffect } from 'react';
import type { MainStackParamList } from '../navigation/types';
import { getAppFlavor } from '../core/flavor';
import { supabase } from '../backend/supabase';

const NAV_OPTIONS: { value: NavPreference; label: string }[] = [
  { value: 'google_maps', label: 'Google Maps' },
  { value: 'waze', label: 'Waze' },
  { value: 'browser', label: 'Navegador' },
];

type Nav = NativeStackNavigationProp<MainStackParamList, 'MainTabs'>;

export function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const flavor = getAppFlavor();
  const { session, signOut } = useAuth();
  const [navPref, setNavPref] = useState<NavPreference>('google_maps');
  const [locationStatus, setLocationStatus] = useState<string>('');
  const [signingOut, setSigningOut] = useState(false);
  const [loadingProfilePhotos, setLoadingProfilePhotos] = useState(false);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [vehiclePhotoUrl, setVehiclePhotoUrl] = useState<string | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    const userId = session?.id;
    if (!userId || flavor !== 'driver') {
      setProfileAvatarUrl(null);
      setVehiclePhotoUrl(null);
      return;
    }

    setLoadingProfilePhotos(true);
    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('avatar_url, vehicle_photo_url')
        .eq('id', userId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setProfileAvatarUrl(null);
        setVehiclePhotoUrl(null);
      } else {
        setProfileAvatarUrl((data?.avatar_url as string | null) ?? null);
        setVehiclePhotoUrl((data?.vehicle_photo_url as string | null) ?? null);
      }
      setLoadingProfilePhotos(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.id, flavor]);

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

      {flavor === 'driver' ? (
        <>
          <Text style={styles.sectionTitle}>Perfil</Text>
          {loadingProfilePhotos ? (
            <View style={styles.profileCard}>
              <ActivityIndicator size="small" color="#166534" />
              <Text style={styles.profileHint}>Cargando fotos...</Text>
            </View>
          ) : (
            <View style={styles.profileCard}>
              <View style={styles.photoBlock}>
                <Text style={styles.photoLabel}>Foto de perfil</Text>
                {profileAvatarUrl ? (
                  <Image source={{ uri: profileAvatarUrl }} style={styles.profilePhoto} />
                ) : (
                  <View style={[styles.profilePhoto, styles.photoPlaceholder]}>
                    <Text style={styles.photoPlaceholderText}>Sin foto</Text>
                  </View>
                )}
              </View>
              <View style={styles.photoBlock}>
                <Text style={styles.photoLabel}>Foto del vehículo</Text>
                {vehiclePhotoUrl ? (
                  <Image source={{ uri: vehiclePhotoUrl }} style={styles.vehiclePhoto} />
                ) : (
                  <View style={[styles.vehiclePhoto, styles.photoPlaceholder]}>
                    <Text style={styles.photoPlaceholderText}>Sin foto</Text>
                  </View>
                )}
              </View>
            </View>
          )}
        </>
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
      {flavor === 'driver' ? (
        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => parentNav?.navigate('DriverTripRequests')}
          accessibilityLabel="Solicitudes de viaje de pasajeros"
          accessibilityRole="button"
        >
          <Text style={styles.linkLabel}>Solicitudes de viaje</Text>
          <Text style={styles.linkArrow}>→</Text>
        </TouchableOpacity>
      ) : (
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
      )}

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
  profileCard: {
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 12,
    gap: 12,
    marginBottom: 8,
  },
  photoBlock: { gap: 6 },
  photoLabel: { fontSize: 13, color: '#374151', fontWeight: '600' },
  profilePhoto: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  vehiclePhoto: {
    width: '100%',
    height: 140,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  photoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPlaceholderText: { color: '#6b7280', fontSize: 12 },
  profileHint: { fontSize: 12, color: '#6b7280' },
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
