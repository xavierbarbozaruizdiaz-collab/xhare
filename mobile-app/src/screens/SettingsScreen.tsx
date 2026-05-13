/**
 * Settings: cuenta, navegación, permisos, Mensajes; Mis solicitudes (pasajero) o Solicitudes de viaje (conductor), cerrar sesión.
 * Perfil/documentos: carga única por defecto; recarga solo si admin la habilita.
 */
import React, { useState, useEffect, useCallback } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { getNavigationPreference, setNavigationPreference, type NavPreference } from '../settings';
import { requestLocationPermission, getLocationPermissionStatus } from '../permissions';
import type { MainStackParamList } from '../navigation/types';
import { getAppFlavor } from '../core/flavor';
import { supabase } from '../backend/supabase';
import { getNavAppAvailability, type NavAppAvailability } from '../external-navigation';

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
  reupload_enabled: boolean | null;
  updated_at: string;
};

const DRIVER_DOCUMENTS: Array<{ type: DriverDocumentType; label: string }> = [
  { type: 'passenger_insurance', label: 'Seguro pasajero' },
  { type: 'dinatran_permit', label: 'Habilitación DINATRAN' },
  { type: 'cedula_verde', label: 'Cédula verde' },
];

const PRIMARY = '#1a5c38';
const PAGE_BG = '#f7f8fa';
const ICON_TILE_BG = '#edf7f1';

export function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const flavor = getAppFlavor();
  const { session, signOut } = useAuth();
  const [navPref, setNavPref] = useState<NavPreference>('google_maps');
  const [navAvailability, setNavAvailability] = useState<NavAppAvailability | null>(null);
  const [locationStatus, setLocationStatus] = useState<string>('');
  const [signingOut, setSigningOut] = useState(false);
  const [loadingProfilePhotos, setLoadingProfilePhotos] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [uploadingDocumentType, setUploadingDocumentType] = useState<DriverDocumentType | null>(null);
  const [driverDocuments, setDriverDocuments] = useState<DriverDocumentRow[]>([]);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [vehiclePhotoUrl, setVehiclePhotoUrl] = useState<string | null>(null);
  const [avatarReuploadEnabled, setAvatarReuploadEnabled] = useState(false);
  const [vehiclePhotoReuploadEnabled, setVehiclePhotoReuploadEnabled] = useState(false);
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
    getLocationPermissionStatus().then((s) =>
      setLocationStatus(s === 'granted' ? 'Concedido' : s === 'denied' ? 'Denegado' : 'No solicitado')
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (flavor !== 'driver') return undefined;
      let active = true;
      void (async () => {
        const avail = await getNavAppAvailability();
        if (!active) return;
        setNavAvailability(avail);
        let pref = await getNavigationPreference();
        if (!avail.waze && pref === 'waze') pref = avail.google_maps ? 'google_maps' : 'browser';
        if (!avail.google_maps && pref === 'google_maps') pref = avail.waze ? 'waze' : 'browser';
        await setNavigationPreference(pref);
        if (!active) return;
        setNavPref(pref);
      })();
      return () => {
        active = false;
      };
    }, [flavor])
  );

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
        .select('avatar_url, vehicle_photo_url, avatar_reupload_enabled, vehicle_photo_reupload_enabled')
        .eq('id', userId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setProfileAvatarUrl(null);
        setVehiclePhotoUrl(null);
        setAvatarReuploadEnabled(false);
        setVehiclePhotoReuploadEnabled(false);
      } else {
        setProfileAvatarUrl((data?.avatar_url as string | null) ?? null);
        setVehiclePhotoUrl(flavor === 'driver' ? ((data?.vehicle_photo_url as string | null) ?? null) : null);
        setAvatarReuploadEnabled(Boolean((data as { avatar_reupload_enabled?: unknown } | null)?.avatar_reupload_enabled));
        setVehiclePhotoReuploadEnabled(
          Boolean((data as { vehicle_photo_reupload_enabled?: unknown } | null)?.vehicle_photo_reupload_enabled)
        );
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
          'id, driver_id, doc_type, storage_bucket, storage_path, file_name, mime_type, file_size_bytes, status, review_notes, expires_at, reupload_enabled, updated_at'
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

  const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    let str = base64.replace(/=+$/, '');
    let output = '';
    let bc = 0;
    let bs = 0;
    let buffer: number;
    let idx = 0;
    while ((buffer = str.charCodeAt(idx++))) {
      const val = chars.indexOf(String.fromCharCode(buffer));
      if (val < 0) continue;
      bs = bc % 4 ? bs * 64 + val : val;
      if (bc++ % 4) output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)));
    }
    const bytes = new Uint8Array(output.length);
    for (let i = 0; i < output.length; i++) bytes[i] = output.charCodeAt(i);
    return bytes.buffer;
  };

  const readUriToArrayBuffer = async (uri: string): Promise<ArrayBuffer> => {
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    return base64ToArrayBuffer(b64);
  };

  const handleUploadAvatar = async () => {
    const userId = session?.id;
    if (!userId || uploadingAvatar) return;
    if (profileAvatarUrl && !avatarReuploadEnabled) {
      Alert.alert(
        'Carga bloqueada',
        'Tu foto de perfil ya fue cargada. Solo podés volver a subir si un admin habilita la recarga.'
      );
      return;
    }
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
      const content = await readUriToArrayBuffer(asset.uri);
      const sizeBytes = asset.fileSize ?? content.byteLength;
      const maxBytes = 3 * 1024 * 1024;
      if (sizeBytes > maxBytes) {
        Alert.alert('Foto muy pesada', 'La imagen supera 3MB. Elegí una más liviana.');
        return;
      }

      const ext = extFromMime(asset.mimeType);
      const bucket = 'profile-avatars';
      const objectPath = `${userId}/avatar-${Date.now()}.${ext}`;
      const oldPath = pathFromPublicUrl(profileAvatarUrl, bucket);

      const { error: upErr } = await supabase.storage.from(bucket).upload(objectPath, content, {
        contentType: asset.mimeType ?? 'image/jpeg',
        cacheControl: '3600',
        upsert: true,
      });
      if (upErr) throw upErr;

      const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
      const newUrl = data.publicUrl;
      const { error: profileErr } = await supabase
        .from('profiles')
        .update({ avatar_url: newUrl, avatar_reupload_enabled: false })
        .eq('id', userId);
      if (profileErr) throw profileErr;

      if (oldPath && oldPath !== objectPath) {
        await supabase.storage.from(bucket).remove([oldPath]);
      }
      setProfileAvatarUrl(newUrl);
      setAvatarReuploadEnabled(false);
      Alert.alert('Listo', 'Tu foto de perfil se actualizó.');
    } catch (e) {
      Alert.alert('No se pudo subir la foto', e instanceof Error ? e.message : 'Intentá de nuevo.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleUploadVehiclePhoto = async () => {
    const userId = session?.id;
    if (!userId || uploadingAvatar) return;
    if (vehiclePhotoUrl && !vehiclePhotoReuploadEnabled) {
      Alert.alert(
        'Carga bloqueada',
        'La foto del vehículo ya fue cargada. Solo podés volver a subir si un admin habilita la recarga.'
      );
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permiso', 'Necesitamos acceso a tus fotos para subir la foto del vehículo.');
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.85,
      aspect: [4, 3],
    });
    if (picked.canceled || !picked.assets?.length) return;
    const asset = picked.assets[0];
    if (!asset?.uri) return;
    try {
      setUploadingAvatar(true);
      const content = await readUriToArrayBuffer(asset.uri);
      const sizeBytes = asset.fileSize ?? content.byteLength;
      const maxBytes = 3 * 1024 * 1024;
      if (sizeBytes > maxBytes) {
        Alert.alert('Foto muy pesada', 'La imagen supera 3MB. Elegí una más liviana.');
        return;
      }
      const ext = extFromMime(asset.mimeType);
      const bucket = 'driver-vehicles';
      const objectPath = `${userId}/vehicle-${Date.now()}.${ext}`;
      const oldPath = pathFromPublicUrl(vehiclePhotoUrl, bucket);
      const { error: upErr } = await supabase.storage.from(bucket).upload(objectPath, content, {
        contentType: asset.mimeType ?? 'image/jpeg',
        cacheControl: '3600',
        upsert: true,
      });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
      const newUrl = data.publicUrl;
      const { error: profileErr } = await supabase
        .from('profiles')
        .update({ vehicle_photo_url: newUrl, vehicle_photo_reupload_enabled: false })
        .eq('id', userId);
      if (profileErr) throw profileErr;
      if (oldPath && oldPath !== objectPath) {
        await supabase.storage.from(bucket).remove([oldPath]);
      }
      setVehiclePhotoUrl(newUrl);
      setVehiclePhotoReuploadEnabled(false);
      Alert.alert('Listo', 'Tu foto del vehículo se actualizó.');
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
    const current = driverDocuments.find((d) => d.doc_type === docType);
    if (current?.file_name && !current.reupload_enabled) {
      Alert.alert(
        'Carga bloqueada',
        'Este documento ya fue cargado. Solo podés reemplazarlo si un admin habilita la recarga.'
      );
      return;
    }
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
      const content = await readUriToArrayBuffer(file.uri);
      const sizeBytes = file.size ?? content.byteLength;
      const maxBytes = 5 * 1024 * 1024;
      if (sizeBytes > maxBytes) {
        Alert.alert('Archivo pesado', 'El archivo supera 5MB. Elegí uno más liviano.');
        return;
      }
      const mime = file.mimeType ?? 'application/octet-stream';
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

      const prev = current;
      if (prev?.storage_path) {
        await supabase.storage.from(bucket).remove([prev.storage_path]);
      }

      const { error: upErr } = await supabase.storage.from(bucket).upload(objectPath, content, {
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
        file_size_bytes: sizeBytes,
        status: 'pending',
        review_notes: null,
        reviewed_by: null,
        reviewed_at: null,
        reupload_enabled: false,
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
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {session?.email ? (
        <View style={styles.heroEmail}>
          <Ionicons name="mail-outline" size={18} color="#64748b" style={styles.heroEmailIcon} />
          <Text style={styles.email}>{session.email}</Text>
        </View>
      ) : null}

      <Text style={[styles.sectionLabel, styles.sectionLabelFirst]}>PERFIL</Text>
      {loadingProfilePhotos ? (
        <View style={styles.profileCard}>
          <ActivityIndicator size="small" color={PRIMARY} />
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
                style={[
                  styles.smallActionBtn,
                  (uploadingAvatar || (profileAvatarUrl != null && !avatarReuploadEnabled)) && styles.buttonDisabled,
                ]}
                onPress={() => void handleUploadAvatar()}
                disabled={uploadingAvatar || (profileAvatarUrl != null && !avatarReuploadEnabled)}
              >
                {uploadingAvatar ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.smallActionBtnText}>
                    {profileAvatarUrl && !avatarReuploadEnabled ? 'Bloqueado por admin' : 'Subir desde dispositivo'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
            <Text style={styles.profileHint}>
              {profileAvatarUrl && !avatarReuploadEnabled
                ? 'Ya cargaste tu foto. Solo admin puede habilitar una nueva carga.'
                : 'Podés subir una sola vez; para reemplazarla necesitás habilitación de admin.'}
            </Text>
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
              <TouchableOpacity
                style={[
                  styles.smallActionBtn,
                  (uploadingAvatar || (vehiclePhotoUrl != null && !vehiclePhotoReuploadEnabled)) && styles.buttonDisabled,
                ]}
                onPress={() => void handleUploadVehiclePhoto()}
                disabled={uploadingAvatar || (vehiclePhotoUrl != null && !vehiclePhotoReuploadEnabled)}
              >
                {uploadingAvatar ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.smallActionBtnText}>
                    {vehiclePhotoUrl && !vehiclePhotoReuploadEnabled ? 'Bloqueado por admin' : 'Subir desde dispositivo'}
                  </Text>
                )}
              </TouchableOpacity>
              <Text style={styles.profileHint}>
                {vehiclePhotoUrl && !vehiclePhotoReuploadEnabled
                  ? 'Ya cargaste la foto del vehículo. Solo admin puede habilitar una nueva carga.'
                  : 'Podés subir una sola vez; para reemplazarla necesitás habilitación de admin.'}
              </Text>
            </View>
          ) : null}
        </View>
      )}

      {flavor === 'driver' ? (
        <>
          <Text style={styles.sectionLabel}>NAVEGACIÓN EXTERNA</Text>
          <Text style={styles.hint}>Al tocar &quot;Abrir en Maps / Waze&quot; en un viaje se usará:</Text>
          {NAV_OPTIONS.map((opt) => {
            const available =
              opt.value === 'browser'
                ? true
                : opt.value === 'waze'
                  ? navAvailability?.waze !== false
                  : navAvailability?.google_maps !== false;
            const disabled = navAvailability != null && !available;
            return (
            <TouchableOpacity
              key={opt.value}
              style={[
                styles.radioRow,
                navPref === opt.value && styles.radioRowActive,
                disabled && styles.radioRowDisabled,
              ]}
              disabled={disabled}
              onPress={async () => {
                if (disabled) return;
                await setNavigationPreference(opt.value);
                setNavPref(opt.value);
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.radioLabel, disabled && styles.radioLabelDisabled]}>{opt.label}</Text>
                {disabled ? (
                  <Text style={styles.radioSub}>No detectada en el dispositivo</Text>
                ) : null}
              </View>
              {navPref === opt.value ? <Ionicons name="checkmark-circle" size={22} color={PRIMARY} /> : null}
            </TouchableOpacity>
            );
          })}
        </>
      ) : null}

      {flavor === 'driver' ? (
        <>
          <Text style={styles.sectionLabel}>DOCUMENTOS DEL CONDUCTOR</Text>
          {loadingDocuments ? (
            <View style={styles.profileCard}>
              <ActivityIndicator size="small" color={PRIMARY} />
              <Text style={styles.profileHint}>Cargando documentos...</Text>
            </View>
          ) : (
            <View style={styles.profileCard}>
              {DRIVER_DOCUMENTS.map((d) => {
                const row = driverDocuments.find((x) => x.doc_type === d.type);
                const canUpload = !row?.file_name || Boolean(row?.reupload_enabled);
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
                      style={[styles.smallActionBtn, (!canUpload || uploading) && styles.buttonDisabled]}
                      onPress={() => void uploadDriverDocument(d.type)}
                      disabled={uploading || !canUpload}
                    >
                      {uploading ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.smallActionBtnText}>
                          {row?.file_name ? (canUpload ? 'Reemplazar documento' : 'Bloqueado por admin') : 'Subir documento'}
                        </Text>
                      )}
                    </TouchableOpacity>
                    {row?.file_name && !canUpload ? (
                      <Text style={styles.profileHint}>
                        Ya cargaste este documento. Solo admin puede habilitar una nueva carga.
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}
        </>
      ) : null}

      <Text style={styles.sectionLabel}>PERMISOS</Text>
      <View style={styles.settingsCard}>
        <View style={styles.permRow}>
          <View style={styles.permTextCol}>
            <Text style={styles.permTitle}>Ubicación</Text>
            <Text style={styles.permStatus}>{locationStatus}</Text>
          </View>
          <TouchableOpacity style={styles.permBtn} onPress={handleRequestLocation}>
            <Text style={styles.permBtnText}>Solicitar</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.sectionLabel}>CUENTA</Text>
      <TouchableOpacity
        style={styles.linkCard}
        onPress={() => parentNav?.navigate('Messages')}
        accessibilityLabel="Mensajes"
        accessibilityHint="Ver conversaciones y chat"
        accessibilityRole="button"
      >
        <View style={styles.linkIconSquare}>
          <Ionicons name="chatbubble-ellipses-outline" size={22} color={PRIMARY} />
        </View>
        <Text style={styles.linkLabel}>Mensajes</Text>
        <Ionicons name="chevron-forward" size={22} color="#94a3b8" />
      </TouchableOpacity>
      {flavor === 'driver' ? (
        <TouchableOpacity
          style={styles.linkCard}
          onPress={() => parentNav?.navigate('DriverTripRequests')}
          accessibilityLabel="Solicitudes de viaje de pasajeros"
          accessibilityRole="button"
        >
          <View style={styles.linkIconSquare}>
            <Ionicons name="document-text-outline" size={22} color={PRIMARY} />
          </View>
          <Text style={styles.linkLabel}>Solicitudes de viaje</Text>
          <Ionicons name="chevron-forward" size={22} color="#94a3b8" />
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={styles.linkCard}
          onPress={() => parentNav?.navigate('MyTripRequests')}
          accessibilityLabel="Mis solicitudes de trayecto"
          accessibilityHint="Solicitudes guardadas cuando no había viajes publicados"
          accessibilityRole="button"
        >
          <View style={styles.linkIconSquare}>
            <Ionicons name="document-text-outline" size={22} color={PRIMARY} />
          </View>
          <Text style={styles.linkLabel}>Mis solicitudes</Text>
          <Ionicons name="chevron-forward" size={22} color="#94a3b8" />
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[styles.signOutBtn, signingOut && styles.buttonDisabled]}
        onPress={handleSignOut}
        disabled={signingOut}
        accessibilityLabel="Cerrar sesión"
        accessibilityRole="button"
        accessibilityHint="Salir de la cuenta"
      >
        {signingOut ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.signOutBtnText}>Cerrar sesión</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: PAGE_BG },
  content: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40 },
  heroEmail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#eef0f3',
  },
  heroEmailIcon: { marginTop: 1 },
  email: { fontSize: 14, color: '#475569', flex: 1, fontFamily: 'DMSans_500Medium' },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.9,
    color: '#64748b',
    fontFamily: 'DMSans_700Bold',
    marginTop: 20,
    marginBottom: 10,
  },
  sectionLabelFirst: { marginTop: 6 },
  settingsCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#eef0f3',
    padding: 16,
    marginBottom: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  profileCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#eef0f3',
    padding: 16,
    gap: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  photoBlock: { gap: 8 },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  photoLabel: { fontSize: 13, color: '#334155', fontWeight: '700', fontFamily: 'DMSans_700Bold' },
  profilePhoto: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: PAGE_BG,
    borderWidth: 2,
    borderColor: '#e2e8f0',
  },
  vehiclePhoto: {
    width: '100%',
    height: 140,
    borderRadius: 16,
    backgroundColor: PAGE_BG,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  photoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPlaceholderText: { color: '#64748b', fontSize: 12, fontFamily: 'DMSans_400Regular' },
  smallActionBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  smallActionBtnText: { color: '#fff', fontSize: 13, fontWeight: '800', fontFamily: 'DMSans_700Bold' },
  docRow: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
    gap: 8,
  },
  docMain: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  docTitle: { fontSize: 14, color: '#0f172a', fontWeight: '800', flex: 1, fontFamily: 'DMSans_700Bold' },
  docMeta: { fontSize: 12, color: '#64748b', fontFamily: 'DMSans_400Regular' },
  docReviewNote: { fontSize: 12, color: '#92400e', lineHeight: 18, fontFamily: 'DMSans_400Regular' },
  docBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  docBadgePending: { backgroundColor: '#fef3c7' },
  docBadgeApproved: { backgroundColor: '#dcfce7' },
  docBadgeRejected: { backgroundColor: '#fee2e2' },
  docBadgeText: { fontSize: 11, fontWeight: '800', color: '#374151', fontFamily: 'DMSans_700Bold' },
  profileHint: { fontSize: 12, color: '#64748b', lineHeight: 17, fontFamily: 'DMSans_400Regular' },
  hint: { fontSize: 13, color: '#64748b', marginBottom: 12, lineHeight: 19, fontFamily: 'DMSans_400Regular' },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    marginBottom: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#eef0f3',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  radioRowActive: { backgroundColor: '#ecfdf5', borderWidth: 2, borderColor: PRIMARY },
  radioRowDisabled: { opacity: 0.55 },
  radioLabelDisabled: { color: '#94a3b8' },
  radioSub: { fontSize: 12, color: '#64748b', marginTop: 2, fontFamily: 'DMSans_400Regular' },
  radioLabel: { fontSize: 15, color: '#0f172a', fontWeight: '600', fontFamily: 'DMSans_600SemiBold' },
  permRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  permTextCol: { flex: 1, minWidth: 0 },
  permTitle: { fontSize: 13, fontWeight: '800', color: '#0f172a', fontFamily: 'DMSans_700Bold' },
  permStatus: { fontSize: 13, color: '#64748b', marginTop: 4, fontFamily: 'DMSans_400Regular' },
  permBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: PRIMARY,
    borderRadius: 14,
  },
  permBtnText: { color: '#fff', fontSize: 14, fontWeight: '800', fontFamily: 'DMSans_700Bold' },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 18,
    marginBottom: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#eef0f3',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  linkIconSquare: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: ICON_TILE_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkLabel: { flex: 1, fontSize: 15, fontWeight: '800', color: '#0f172a', fontFamily: 'DMSans_700Bold' },
  buttonDisabled: { opacity: 0.65 },
  signOutBtn: {
    backgroundColor: '#dc2626',
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 20,
    shadowColor: '#dc2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 3,
  },
  signOutBtnText: { color: '#fff', fontSize: 16, fontWeight: '800', fontFamily: 'DMSans_700Bold' },
});
