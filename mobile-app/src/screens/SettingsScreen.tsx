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
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
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
type DriverDocumentType = 'passenger_insurance' | 'dinatran_permit' | 'cedula_verde';
type DriverDocumentStatus = 'pending' | 'approved' | 'rejected';
type DriverDocumentRow = {
  id: string;
  driver_id: string;
  doc_type: DriverDocumentType;
  storage_bucket: string;
  storage_path: string;
  file_name: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  status: DriverDocumentStatus;
  review_notes: string | null;
  expires_at: string | null;
  updated_at: string;
};

const DRIVER_DOCUMENTS: Array<{ type: DriverDocumentType; label: string }> = [
  { type: 'passenger_insurance', label: 'Seguro pasajero' },
  { type: 'dinatran_permit', label: 'Habilitación DINATRAN' },
  { type: 'cedula_verde', label: 'Cédula verde' },
];

export function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const flavor = getAppFlavor();
  const { session, signOut } = useAuth();
  const [navPref, setNavPref] = useState<NavPreference>('google_maps');
  const [locationStatus, setLocationStatus] = useState<string>('');
  const [signingOut, setSigningOut] = useState(false);
  const [loadingProfilePhotos, setLoadingProfilePhotos] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [uploadingDocumentType, setUploadingDocumentType] = useState<DriverDocumentType | null>(null);
  const [driverDocuments, setDriverDocuments] = useState<DriverDocumentRow[]>([]);
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
    if (!userId) {
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
        setVehiclePhotoUrl(flavor === 'driver' ? ((data?.vehicle_photo_url as string | null) ?? null) : null);
      }
      setLoadingProfilePhotos(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.id, flavor]);

  const loadDriverDocuments = async () => {
    const userId = session?.id;
    if (!userId || flavor !== 'driver') {
      setDriverDocuments([]);
      return;
    }
    setLoadingDocuments(true);
    try {
      const { data, error } = await supabase
        .from('driver_documents')
        .select(
          'id, driver_id, doc_type, storage_bucket, storage_path, file_name, mime_type, file_size_bytes, status, review_notes, expires_at, updated_at'
        )
        .eq('driver_id', userId)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      setDriverDocuments((data ?? []) as DriverDocumentRow[]);
    } catch {
      setDriverDocuments([]);
    } finally {
      setLoadingDocuments(false);
    }
  };

  useEffect(() => {
    void loadDriverDocuments();
  }, [session?.id, flavor]);

  const extFromMime = (mimeType: string | null | undefined): string => {
    const t = String(mimeType ?? '').toLowerCase();
    if (t.includes('png')) return 'png';
    if (t.includes('webp')) return 'webp';
    return 'jpg';
  };

  const pathFromPublicUrl = (url: string | null, bucket: string): string | null => {
    if (!url) return null;
    const marker = `/storage/v1/object/public/${bucket}/`;
    const idx = url.indexOf(marker);
    if (idx < 0) return null;
    const tail = url.slice(idx + marker.length);
    if (!tail) return null;
    return tail.split('?')[0] ?? null;
  };

  const handleUploadAvatar = async () => {
    const userId = session?.id;
    if (!userId || uploadingAvatar) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permiso', 'Necesitamos acceso a tus fotos para actualizar tu avatar.');
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
      aspect: [1, 1],
    });
    if (picked.canceled || !picked.assets?.length) return;
    const asset = picked.assets[0];
    if (!asset?.uri) return;

    try {
      setUploadingAvatar(true);
      const res = await fetch(asset.uri);
      const blob = await res.blob();
      const maxBytes = 3 * 1024 * 1024;
      if (blob.size > maxBytes) {
        Alert.alert('Foto muy pesada', 'La imagen supera 3MB. Elegí una más liviana.');
        return;
      }

      const ext = extFromMime(asset.mimeType);
      const bucket = 'profile-avatars';
      const objectPath = `${userId}/avatar-${Date.now()}.${ext}`;
      const oldPath = pathFromPublicUrl(profileAvatarUrl, bucket);

      const { error: upErr } = await supabase.storage.from(bucket).upload(objectPath, blob, {
        contentType: asset.mimeType ?? 'image/jpeg',
        cacheControl: '3600',
        upsert: true,
      });
      if (upErr) throw upErr;

      const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
      const newUrl = data.publicUrl;
      const { error: profileErr } = await supabase
        .from('profiles')
        .update({ avatar_url: newUrl })
        .eq('id', userId);
      if (profileErr) throw profileErr;

      if (oldPath && oldPath !== objectPath) {
        await supabase.storage.from(bucket).remove([oldPath]);
      }
      setProfileAvatarUrl(newUrl);
      Alert.alert('Listo', 'Tu foto de perfil se actualizó.');
    } catch (e) {
      Alert.alert('No se pudo subir la foto', e instanceof Error ? e.message : 'Intentá de nuevo.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const statusLabel = (status: DriverDocumentStatus): string => {
    if (status === 'approved') return 'Aprobado';
    if (status === 'rejected') return 'Rechazado';
    return 'En revisión';
  };

  const statusStyle = (status: DriverDocumentStatus) => {
    if (status === 'approved') return styles.docBadgeApproved;
    if (status === 'rejected') return styles.docBadgeRejected;
    return styles.docBadgePending;
  };

  const uploadDriverDocument = async (docType: DriverDocumentType) => {
    const userId = session?.id;
    if (!userId || uploadingDocumentType) return;
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled || !picked.assets?.length) return;
    const file = picked.assets[0];
    if (!file?.uri) return;
    try {
      setUploadingDocumentType(docType);
      const response = await fetch(file.uri);
      const blob = await response.blob();
      const maxBytes = 5 * 1024 * 1024;
      if (blob.size > maxBytes) {
        Alert.alert('Archivo pesado', 'El archivo supera 5MB. Elegí uno más liviano.');
        return;
      }
      const mime = file.mimeType ?? blob.type ?? 'application/octet-stream';
      const ext =
        mime === 'application/pdf'
          ? 'pdf'
          : mime.includes('png')
            ? 'png'
            : mime.includes('webp')
              ? 'webp'
              : 'jpg';
      const bucket = 'driver-documents';
      const objectPath = `${userId}/${docType}/document-${Date.now()}.${ext}`;

      const prev = driverDocuments.find((d) => d.doc_type === docType);
      if (prev?.storage_path) {
        await supabase.storage.from(bucket).remove([prev.storage_path]);
      }

      const { error: upErr } = await supabase.storage.from(bucket).upload(objectPath, blob, {
        contentType: mime,
        cacheControl: '3600',
        upsert: true,
      });
      if (upErr) throw upErr;

      const payload = {
        driver_id: userId,
        doc_type: docType,
        storage_bucket: bucket,
        storage_path: objectPath,
        file_name: file.name ?? null,
        mime_type: mime,
        file_size_bytes: blob.size,
        status: 'pending',
        review_notes: null,
        reviewed_by: null,
        reviewed_at: null,
      };
      const { error: dbErr } = await supabase
        .from('driver_documents')
        .upsert(payload, { onConflict: 'driver_id,doc_type' });
      if (dbErr) throw dbErr;

      await loadDriverDocuments();
      Alert.alert('Listo', 'Documento cargado. Quedó en revisión.');
    } catch (e) {
      Alert.alert('No se pudo cargar', e instanceof Error ? e.message : 'Intentá de nuevo.');
    } finally {
      setUploadingDocumentType(null);
    }
  };

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
            <View style={styles.avatarRow}>
              {profileAvatarUrl ? (
                <Image source={{ uri: profileAvatarUrl }} style={styles.profilePhoto} />
              ) : (
                <View style={[styles.profilePhoto, styles.photoPlaceholder]}>
                  <Text style={styles.photoPlaceholderText}>Sin foto</Text>
                </View>
              )}
              <TouchableOpacity
                style={[styles.smallActionBtn, uploadingAvatar && styles.buttonDisabled]}
                onPress={() => void handleUploadAvatar()}
                disabled={uploadingAvatar}
              >
                {uploadingAvatar ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.smallActionBtnText}>Subir desde dispositivo</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
          {flavor === 'driver' ? (
            <View style={styles.photoBlock}>
              <Text style={styles.photoLabel}>Foto del vehículo</Text>
              {vehiclePhotoUrl ? (
                <Image source={{ uri: vehiclePhotoUrl }} style={styles.vehiclePhoto} />
              ) : (
                <View style={[styles.vehiclePhoto, styles.photoPlaceholder]}>
                  <Text style={styles.photoPlaceholderText}>Sin foto</Text>
                </View>
              )}
              <Text style={styles.profileHint}>La foto del vehículo sigue gestionada desde panel admin.</Text>
            </View>
          ) : null}
        </View>
      )}

      {flavor === 'driver' ? (
        <>
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
        </>
      ) : null}

      {flavor === 'driver' ? (
        <>
          <Text style={styles.sectionTitle}>Documentos del conductor</Text>
          {loadingDocuments ? (
            <View style={styles.profileCard}>
              <ActivityIndicator size="small" color="#166534" />
              <Text style={styles.profileHint}>Cargando documentos...</Text>
            </View>
          ) : (
            <View style={styles.profileCard}>
              {DRIVER_DOCUMENTS.map((d) => {
                const row = driverDocuments.find((x) => x.doc_type === d.type);
                const uploading = uploadingDocumentType === d.type;
                return (
                  <View key={d.type} style={styles.docRow}>
                    <View style={styles.docMain}>
                      <Text style={styles.docTitle}>{d.label}</Text>
                      <View style={[styles.docBadge, statusStyle(row?.status ?? 'pending')]}>
                        <Text style={styles.docBadgeText}>{statusLabel(row?.status ?? 'pending')}</Text>
                      </View>
                    </View>
                    <Text style={styles.docMeta} numberOfLines={1}>
                      {row?.file_name ? `Archivo: ${row.file_name}` : 'Sin archivo cargado'}
                    </Text>
                    {row?.expires_at ? (
                      <Text style={styles.docMeta}>Vence: {new Date(`${row.expires_at}T00:00:00`).toLocaleDateString('es-PY')}</Text>
                    ) : null}
                    {row?.review_notes ? (
                      <Text style={styles.docReviewNote}>Observación admin: {row.review_notes}</Text>
                    ) : null}
                    <TouchableOpacity
                      style={[styles.smallActionBtn, uploading && styles.buttonDisabled]}
                      onPress={() => void uploadDriverDocument(d.type)}
                      disabled={uploading}
                    >
                      {uploading ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.smallActionBtnText}>
                          {row?.file_name ? 'Reemplazar documento' : 'Subir documento'}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}
        </>
      ) : null}

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
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
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
  smallActionBtn: {
    backgroundColor: '#166534',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  smallActionBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  docRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    gap: 6,
  },
  docMain: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  docTitle: { fontSize: 14, color: '#111827', fontWeight: '700', flex: 1 },
  docMeta: { fontSize: 12, color: '#6b7280' },
  docReviewNote: { fontSize: 12, color: '#92400e', lineHeight: 16 },
  docBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  docBadgePending: { backgroundColor: '#fef3c7' },
  docBadgeApproved: { backgroundColor: '#dcfce7' },
  docBadgeRejected: { backgroundColor: '#fee2e2' },
  docBadgeText: { fontSize: 11, fontWeight: '700', color: '#374151' },
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
