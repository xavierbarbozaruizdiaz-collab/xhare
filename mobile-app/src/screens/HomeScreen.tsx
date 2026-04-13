/**
 * Home base: bienvenida, favoritos (pasajero), accesos rapidos, banners conductor/admin.
 */
import React, { useCallback, useEffect, useMemo, useState, type ComponentProps } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Modal,
  Pressable,
  Switch,
  AppState,
  type AppStateStatus,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import type { MainTabParamList } from '../navigation/types';
import { getAppFlavor } from '../core/flavor';
import {
  fetchPassengerHomeFavoritesCopy,
  fetchPassengerHomeShortcutsVisible,
  DEFAULT_PASSENGER_HOME_FAVORITES_TITLE,
  DEFAULT_PASSENGER_HOME_FAVORITES_SUBTITLE,
} from '../backend/passengerUiSettings';
import { pushPassengerHomeMapShortcuts } from '../backend/passengerHomeMapShortcutSync';
import {
  loadPassengerFavorites,
  getPassengerFavorite,
  upsertPassengerFavorite,
  removePassengerFavorite,
  getFavoritePreset,
  favoritePairLabel,
  isFavoriteEnabled,
  computeNextTriggerIso,
  type PassengerFavoriteSlot,
  type PassengerFavoriteSnapshot,
} from '../lib/passengerFavorites';

type IonName = ComponentProps<typeof Ionicons>['name'];

/**
 * Modal: muchas opciones visuales; siempre se abre uno de los dos slots fijos (Casa→Trabajo / Trabajo→Casa).
 * Origen / destino en listas separadas para combinar con flechas.
 */
const MODAL_ORIGIN_ICONS: IonName[] = [
  'home-outline',
  'car-outline',
  'bus-outline',
  'walk-outline',
  'cafe-outline',
  'navigate-outline',
  'location-outline',
  'train-outline',
];

const MODAL_DEST_ICONS: IonName[] = [
  'briefcase-outline',
  'school-outline',
  'library-outline',
  'business-outline',
  'barbell-outline',
  'airplane-outline',
  'medical-outline',
  'cart-outline',
  'restaurant-outline',
];

const HOME_SIDE_ICONS = new Set<string>(['home-outline']);
const WORK_SIDE_ICONS = new Set<string>([
  'briefcase-outline',
  'school-outline',
  'library-outline',
  'business-outline',
  'barbell-outline',
  'airplane-outline',
  'medical-outline',
  'cart-outline',
  'restaurant-outline',
]);

function inferModalFavoriteSlot(from: string, to: string): 'home_to_work' | 'work_to_home' | null {
  const fHome = HOME_SIDE_ICONS.has(from);
  const tHome = HOME_SIDE_ICONS.has(to);
  const fWork = WORK_SIDE_ICONS.has(from);
  const tWork = WORK_SIDE_ICONS.has(to);
  if (fHome && tWork) return 'home_to_work';
  if (fWork && tHome) return 'work_to_home';
  if (!fWork && tWork) return 'home_to_work';
  if (fWork && !tWork && !tHome) return 'work_to_home';
  return null;
}

function FavoritePairIcons({
  slot,
  iconSize = 22,
  arrowSize = 18,
}: {
  slot: PassengerFavoriteSlot;
  iconSize?: number;
  arrowSize?: number;
}) {
  const preset = getFavoritePreset(slot);
  const from = (preset?.from ?? 'git-network-outline') as IonName;
  const to = (preset?.to ?? 'location-outline') as IonName;
  return (
    <View style={styles.pairIconRow}>
      <Ionicons name={from} size={iconSize} color="#14532d" />
      <Ionicons name="arrow-forward" size={arrowSize} color="#6b7280" style={styles.pairArrow} />
      <Ionicons name={to} size={iconSize} color="#14532d" />
    </View>
  );
}

type HomeTabNav = BottomTabNavigationProp<MainTabParamList, 'Home'>;
type ParentNav = { navigate: (name: string, params?: object) => void };
const HOME_FIXED_SLOTS: PassengerFavoriteSlot[] = ['home_to_work', 'work_to_home'];

function favoriteHasConfig(snap: PassengerFavoriteSnapshot | undefined): boolean {
  if (!snap) return false;
  if (snap.origin.trim() && snap.destination.trim()) return true;
  return (
    snap.originLat != null &&
    snap.originLng != null &&
    snap.destinationLat != null &&
    snap.destinationLng != null
  );
}

function isScheduleDailySnap(snap: PassengerFavoriteSnapshot): boolean {
  const v = snap.scheduleDaily as unknown;
  if (v === true) return true;
  if (typeof v === 'string' && v.toLowerCase() === 'true') return true;
  if (v === 1) return true;
  return false;
}

function scheduleLabel(snap: PassengerFavoriteSnapshot | undefined): string {
  if (!snap) return 'Sin configurar';
  const baseDate = (snap.scheduledDateYmd ?? snap.date ?? '').trim();
  const baseTime = (snap.scheduledTimeHm ?? snap.fromTime ?? '').trim() || '08:00';
  if (isScheduleDailySnap(snap)) {
    const nextIso = snap.nextTriggerAtIso?.trim();
    const nextText = nextIso
      ? new Date(nextIso).toLocaleDateString('es-PY', {
          day: '2-digit',
          month: '2-digit',
        })
      : 'proximo dia';
    return `Diario ${baseTime} · prox ${nextText}`;
  }
  return `Fecha ${baseDate || '--'} · ${baseTime}`;
}

export function HomeScreen() {
  const navigation = useNavigation<HomeTabNav>();
  const { session } = useAuth();
  const role = session?.role;
  const flavor = getAppFlavor();
  const isPassengerFlavor = flavor !== 'driver';
  const parentNav = navigation.getParent() as ParentNav | undefined;
  const userId = session?.id ?? '';

  const [favorites, setFavorites] = useState<Partial<Record<PassengerFavoriteSlot, PassengerFavoriteSnapshot>>>({});
  const [addFavoriteOpen, setAddFavoriteOpen] = useState(false);
  const [homeShortcutsVisible, setHomeShortcutsVisible] = useState(true);
  const [favoritesTitle, setFavoritesTitle] = useState(DEFAULT_PASSENGER_HOME_FAVORITES_TITLE);
  const [favoritesSubtitle, setFavoritesSubtitle] = useState(DEFAULT_PASSENGER_HOME_FAVORITES_SUBTITLE);
  const [fromIconIndex, setFromIconIndex] = useState(0);
  const [toIconIndex, setToIconIndex] = useState(0);

  const homeFavoriteSlots = useMemo(() => HOME_FIXED_SLOTS, []);
  const selectedFromIcon = (MODAL_ORIGIN_ICONS[fromIconIndex] ?? MODAL_ORIGIN_ICONS[0]) as string;
  const selectedToIcon = (MODAL_DEST_ICONS[toIconIndex] ?? MODAL_DEST_ICONS[0]) as string;

  const refreshFavorites = useCallback(() => {
    if (!userId) {
      setFavorites({});
      return;
    }
    void loadPassengerFavorites(userId).then((store) => {
      setFavorites(store);
      void pushPassengerHomeMapShortcuts(store);
    });
  }, [userId]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active' && userId && isPassengerFlavor) {
        refreshFavorites();
      }
    });
    return () => sub.remove();
  }, [userId, isPassengerFlavor, refreshFavorites]);

  useFocusEffect(
    useCallback(() => {
      refreshFavorites();
    }, [refreshFavorites])
  );

  useFocusEffect(
    useCallback(() => {
      if (!session || !isPassengerFlavor) return;
      let cancelled = false;
      void (async () => {
        const [visible, copy] = await Promise.all([
          fetchPassengerHomeShortcutsVisible(),
          fetchPassengerHomeFavoritesCopy(),
        ]);
        if (!cancelled) {
          setHomeShortcutsVisible(visible);
          setFavoritesTitle(copy.title);
          setFavoritesSubtitle(copy.subtitle);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [session, isPassengerFlavor])
  );

  const goFavorite = useCallback(
    (slot: PassengerFavoriteSlot) => {
      if (!session) {
        Alert.alert('Inicia sesion', 'Necesitas una cuenta para guardar favoritos.');
        return;
      }
      setAddFavoriteOpen(false);
      parentNav?.navigate('SearchPublishedRides', { favoriteSlot: slot });
    },
    [parentNav, session]
  );

  const openAddFavorite = useCallback(() => {
    if (!session) {
      Alert.alert('Inicia sesion', 'Necesitas una cuenta para guardar favoritos.');
      return;
    }
    setFromIconIndex(0);
    setToIconIndex(0);
    setAddFavoriteOpen(true);
  }, [session]);

  const rotateOriginIndex = useCallback((index: number, delta: number) => {
    const len = MODAL_ORIGIN_ICONS.length;
    if (!len) return 0;
    return (index + delta + len) % len;
  }, []);

  const rotateDestIndex = useCallback((index: number, delta: number) => {
    const len = MODAL_DEST_ICONS.length;
    if (!len) return 0;
    return (index + delta + len) % len;
  }, []);

  const saveSelectedFavorite = useCallback(() => {
    if (selectedFromIcon === selectedToIcon) {
      Alert.alert('Elegí dos iconos distintos', 'El origen y el destino no pueden ser el mismo icono.');
      return;
    }
    const slot = inferModalFavoriteSlot(selectedFromIcon, selectedToIcon);
    if (slot) {
      goFavorite(slot);
      return;
    }
    Alert.alert(
      'Combinación no clara',
      'Elegí un origen (casa, auto, bus…) y un destino tipo trabajo, estudio, gym, aeropuerto o comercio; o al revés (trabajo → casa).'
    );
  }, [goFavorite, selectedFromIcon, selectedToIcon]);

  const toggleFavorite = useCallback(
    async (slot: PassengerFavoriteSlot, enabled: boolean) => {
      if (!session || !userId) return;
      const snap = await getPassengerFavorite(userId, slot);
      if (!snap) {
        if (enabled) {
          Alert.alert('Primero configuralo', `Completa ${favoritePairLabel(slot)} y luego activa el switch.`);
          goFavorite(slot);
        }
        return;
      }
      await upsertPassengerFavorite(userId, slot, {
        date: snap.date,
        fromTime: snap.fromTime,
        routeNameQuery: snap.routeNameQuery,
        origin: snap.origin,
        destination: snap.destination,
        originLat: snap.originLat,
        originLng: snap.originLng,
        destinationLat: snap.destinationLat,
        destinationLng: snap.destinationLng,
        rideKind: snap.rideKind,
        enabled,
        scheduleDaily: Boolean(snap.scheduleDaily),
        scheduledDateYmd: snap.scheduledDateYmd ?? snap.date,
        scheduledTimeHm: snap.scheduledTimeHm ?? snap.fromTime,
        nextTriggerAtIso:
          computeNextTriggerIso(
            new Date(),
            snap.scheduledDateYmd ?? snap.date,
            snap.scheduledTimeHm ?? snap.fromTime,
            Boolean(snap.scheduleDaily)
          ) ?? undefined,
      });
      const all = await loadPassengerFavorites(userId);
      setFavorites(all);
      void pushPassengerHomeMapShortcuts(all);
    },
    [goFavorite, session, userId]
  );

  const deleteFavorite = useCallback(
    (slot: PassengerFavoriteSlot) => {
      if (!session || !userId) return;
      Alert.alert('Eliminar favorito', `Se eliminara ${favoritePairLabel(slot)} de Inicio.`, [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await removePassengerFavorite(userId, slot);
              const all = await loadPassengerFavorites(userId);
              setFavorites(all);
              void pushPassengerHomeMapShortcuts(all);
            })();
          },
        },
      ]);
    },
    [session, userId]
  );

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
            <Text style={styles.bannerText}>
              Tu cuenta de conductor esta en revision. Cuando sea aprobada podras publicar viajes.
            </Text>
          </View>
        )}
        {role === 'admin' && (
          <View style={styles.bannerInfo}>
            <Text style={styles.bannerText}>Para administrar precios, facturacion y metricas usa el panel web.</Text>
          </View>
        )}

        {isPassengerFlavor && session ? (
          <>
            <Text style={styles.welcomePassenger}>
              {favoritesTitle}
            </Text>
            <Text style={styles.subLead}>{favoritesSubtitle}</Text>

            <View style={styles.favoritesBox}>
              <TouchableOpacity
                style={styles.favoritesPrimaryBtn}
                onPress={openAddFavorite}
                accessibilityRole="button"
                accessibilityLabel="Elegir trayecto favorito para agregar o editar"
              >
                <Ionicons name="add-circle-outline" size={22} color="#fff" style={styles.favoritesPrimaryIcon} />
                <Text style={styles.favoritesPrimaryBtnText}>AGREGAR TRAYECTO FAVORITO</Text>
              </TouchableOpacity>

              <ScrollView
                style={styles.favoriteStackScroll}
                contentContainerStyle={styles.favoriteStackContent}
                nestedScrollEnabled
                showsVerticalScrollIndicator
              >
                {homeFavoriteSlots.map((slot) => {
                  const snap = favorites[slot];
                  const enabled = isFavoriteEnabled(snap);
                  const configured = favoriteHasConfig(snap);
                  return (
                    <TouchableOpacity
                      key={slot}
                      style={styles.favoriteRow}
                      onPress={() => goFavorite(slot)}
                      accessibilityRole="button"
                      accessibilityLabel={`Favorito ${favoritePairLabel(slot)}`}
                    >
                      <TouchableOpacity
                        style={styles.favoriteDeleteBtn}
                        onPress={() => deleteFavorite(slot)}
                        accessibilityRole="button"
                        accessibilityLabel={`Eliminar ${favoritePairLabel(slot)}`}
                      >
                        <Ionicons name="close" size={12} color="#b91c1c" />
                      </TouchableOpacity>
                      <View style={styles.favoriteRowLeft}>
                        <View style={styles.favoriteRowTitleRow}>
                          <FavoritePairIcons slot={slot} iconSize={20} arrowSize={16} />
                          {configured && enabled ? (
                            <View style={styles.favoriteActiveBadge}>
                              <Text style={styles.favoriteActiveBadgeText}>Activo</Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={styles.favoriteRowLabel}>{favoritePairLabel(slot)}</Text>
                        <Text style={styles.favoriteRowTime}>{scheduleLabel(snap)}</Text>
                      </View>
                      <View style={styles.favoriteRowRight}>
                        <Switch
                          value={enabled}
                          onValueChange={(v) => {
                            void toggleFavorite(slot, v);
                          }}
                          trackColor={{ false: '#d1d5db', true: '#86efac' }}
                          thumbColor={enabled ? '#166534' : '#f3f4f6'}
                        />
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            <Modal
              visible={addFavoriteOpen}
              animationType="slide"
              transparent
              onRequestClose={() => setAddFavoriteOpen(false)}
            >
              <View style={styles.modalRoot}>
                <Pressable style={styles.modalBackdrop} onPress={() => setAddFavoriteOpen(false)} />
                <SafeAreaView style={styles.modalSheet} edges={['bottom']}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>Elige el trayecto a guardar</Text>
                    <TouchableOpacity onPress={() => setAddFavoriteOpen(false)} hitSlop={12} accessibilityRole="button">
                      <Text style={styles.modalClose}>Cerrar</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.modalHint}>
                    Elegí origen y destino con las flechas: se abre Casa→Trabajo o Trabajo→Casa según la combinación
                    (casa u origen “hacia” trabajo, estudio, gym, etc.).
                  </Text>
                  <View style={styles.modalPickerWrap}>
                    <View style={styles.modalPickerRow}>
                      <View style={styles.modalSelectorColumn}>
                        <TouchableOpacity
                          style={styles.modalArrowBtn}
                          onPress={() => setFromIconIndex((v) => rotateOriginIndex(v, -1))}
                          accessibilityRole="button"
                          accessibilityLabel="Icono origen anterior"
                        >
                          <Ionicons name="chevron-up" size={22} color="#14532d" />
                        </TouchableOpacity>
                        <View style={styles.modalIconBox}>
                          <Ionicons name={selectedFromIcon as IonName} size={30} color="#14532d" />
                        </View>
                        <TouchableOpacity
                          style={styles.modalArrowBtn}
                          onPress={() => setFromIconIndex((v) => rotateOriginIndex(v, 1))}
                          accessibilityRole="button"
                          accessibilityLabel="Icono origen siguiente"
                        >
                          <Ionicons name="chevron-down" size={22} color="#14532d" />
                        </TouchableOpacity>
                      </View>
                      <View style={styles.modalMiddleArrowBadge}>
                        <Ionicons name="arrow-forward" size={30} color="#166534" style={styles.modalMiddleArrow} />
                      </View>

                      <View style={styles.modalSelectorColumn}>
                        <TouchableOpacity
                          style={styles.modalArrowBtn}
                          onPress={() => setToIconIndex((v) => rotateDestIndex(v, -1))}
                          accessibilityRole="button"
                          accessibilityLabel="Icono destino anterior"
                        >
                          <Ionicons name="chevron-up" size={22} color="#14532d" />
                        </TouchableOpacity>
                        <View style={styles.modalIconBox}>
                          <Ionicons name={selectedToIcon as IonName} size={30} color="#14532d" />
                        </View>
                        <TouchableOpacity
                          style={styles.modalArrowBtn}
                          onPress={() => setToIconIndex((v) => rotateDestIndex(v, 1))}
                          accessibilityRole="button"
                          accessibilityLabel="Icono destino siguiente"
                        >
                          <Ionicons name="chevron-down" size={22} color="#14532d" />
                        </TouchableOpacity>
                      </View>
                    </View>
                    <Text style={styles.modalCounterText}>
                      {`Origen ${fromIconIndex + 1}/${MODAL_ORIGIN_ICONS.length} · Destino ${toIconIndex + 1}/${MODAL_DEST_ICONS.length}`}
                    </Text>
                    <TouchableOpacity
                      style={styles.modalSaveBtn}
                      onPress={saveSelectedFavorite}
                      accessibilityRole="button"
                      accessibilityLabel="Guardar este trayecto favorito"
                    >
                      <Text style={styles.modalSaveBtnText}>Usar este trayecto</Text>
                    </TouchableOpacity>
                  </View>
                </SafeAreaView>
              </View>
            </Modal>

            {homeShortcutsVisible ? (
              <>
                <TouchableOpacity
                  style={styles.fakeSearch}
                  onPress={() => parentNav?.navigate('SearchPublishedRides', {})}
                  accessibilityRole="button"
                  accessibilityLabel="Buscar viajes"
                >
                  <Ionicons name="search" size={20} color="#9ca3af" style={styles.fakeSearchIcon} />
                  <Text style={styles.fakeSearchPlaceholder}>A donde queres ir hoy? (Rutas populares, lineas...)</Text>
                </TouchableOpacity>

                <View style={styles.rowTwo}>
                  <TouchableOpacity style={styles.btnMint} onPress={() => parentNav?.navigate('SearchPublishedRides', {})} accessibilityRole="button">
                    <Text style={styles.btnMintText}>Buscar viajes</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btnMint} onPress={() => parentNav?.navigate('MyBookings')} accessibilityRole="button">
                    <Text style={styles.btnMintText}>Mis reservas</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.rowTwo}>
                  <TouchableOpacity style={styles.btnMint} onPress={() => parentNav?.navigate('Messages')} accessibilityRole="button">
                    <View style={styles.btnMintInner}>
                      <Ionicons name="chatbubble-ellipses-outline" size={20} color="#14532d" />
                      <Text style={styles.btnMintText}>Mensajes</Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btnMint} onPress={() => parentNav?.navigate('MyTripRequests')} accessibilityRole="button">
                    <View style={styles.btnMintInner}>
                      <Ionicons name="document-text-outline" size={20} color="#14532d" />
                      <Text style={styles.btnMintText}>Mis solicitudes</Text>
                    </View>
                  </TouchableOpacity>
                </View>
              </>
            ) : null}
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#f0fdf4' },
  scrollContent: { flexGrow: 1, padding: 20, paddingBottom: 32 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#d1fae5',
  },
  welcomePassenger: { fontSize: 20, fontWeight: '800', color: '#14532d', marginBottom: 8, lineHeight: 26 },
  subLead: { fontSize: 14, color: '#4b5563', lineHeight: 21, marginBottom: 14 },
  bannerWarning: { backgroundColor: '#fef3c7', padding: 12, borderRadius: 8, marginBottom: 16, borderWidth: 1, borderColor: '#f59e0b' },
  bannerInfo: { backgroundColor: '#dbeafe', padding: 12, borderRadius: 8, marginBottom: 16, borderWidth: 1, borderColor: '#3b82f6' },
  bannerText: { fontSize: 14, color: '#1f2937' },
  favoritesBox: { borderWidth: 1, borderColor: '#86efac', borderRadius: 14, padding: 14, marginBottom: 16, backgroundColor: '#f0fdf4' },
  favoritesPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#14532d',
    paddingVertical: 14,
    borderRadius: 10,
    marginBottom: 12,
  },
  favoritesPrimaryIcon: { marginRight: 8 },
  favoritesPrimaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 13, letterSpacing: 0.3 },
  pairIconRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  pairArrow: { marginHorizontal: 3 },
  favoriteRowTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 8,
    flexWrap: 'wrap',
  },
  favoriteActiveBadge: {
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#86efac',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  favoriteActiveBadgeText: { fontSize: 11, fontWeight: '700', color: '#166534' },
  favoriteStackScroll: { maxHeight: 360 },
  favoriteStackContent: { gap: 8, paddingBottom: 4 },
  favoriteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 12,
    backgroundColor: '#fff',
    paddingVertical: 10,
    paddingHorizontal: 10,
    gap: 8,
  },
  favoriteRowLeft: { flex: 1, minWidth: 0 },
  favoriteRowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  favoriteDeleteBtn: {
    position: 'absolute',
    top: 6,
    right: 8,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fff1f2',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  favoriteRowLabel: { fontSize: 13, fontWeight: '700', color: '#14532d', marginTop: 4 },
  favoriteRowTime: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '60%', paddingBottom: 8 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#111', flex: 1, paddingRight: 8 },
  modalClose: { fontSize: 16, fontWeight: '600', color: '#166534' },
  modalHint: { fontSize: 13, color: '#6b7280', paddingHorizontal: 16, paddingVertical: 10, lineHeight: 18 },
  modalPickerWrap: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  modalPickerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  modalSelectorColumn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 84,
  },
  modalIconBox: {
    width: 58,
    height: 58,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    backgroundColor: '#f0fdf4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalArrowBtn: {
    width: 40,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalMiddleArrowBadge: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#bbf7d0',
    borderWidth: 1,
    borderColor: '#4ade80',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 34,
  },
  modalMiddleArrow: { marginLeft: 1 },
  modalCounterText: { textAlign: 'center', color: '#94a3b8', fontSize: 12, marginTop: 6, marginBottom: 14 },
  modalSaveBtn: {
    backgroundColor: '#14532d',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  modalSaveBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  fakeSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
    backgroundColor: '#f9fafb',
  },
  fakeSearchIcon: { marginRight: 10 },
  fakeSearchPlaceholder: { flex: 1, fontSize: 14, color: '#9ca3af' },
  rowTwo: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  btnMint: {
    flex: 1,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#86efac',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnMintInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnMintText: { fontSize: 14, fontWeight: '700', color: '#14532d' },
});
