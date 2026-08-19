/**
 * Home: bienvenida, accesos rapidos, banners conductor/admin.
 * Las rutas guardadas del pasajero viven en SavedRoutesScreen.
 */
import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Switch,
  AppState,
  type AppStateStatus,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth/AuthContext';
import type { SessionProfile } from '../auth/session';
import type { MainTabParamList } from '../navigation/types';
import { fetchMyConversations } from '../api/messages';
import { getAppFlavor } from '../core/flavor';
import {
  fetchPassengerHomeFavoritesCopy,
  fetchPassengerHomeShortcutsVisible,
  readPassengerHomeFavoritesCopyCache,
  passengerHomeHeroFingerprint,
  isPassengerHomeHeroDismissed,
  dismissPassengerHomeHero,
  PASSENGER_HOME_HERO_EYEBROW,
  DEFAULT_PASSENGER_HOME_FAVORITES_TITLE,
  DEFAULT_PASSENGER_HOME_FAVORITES_SUBTITLE,
} from '../backend/passengerUiSettings';
import { fetchDriverHomeHowTo, DEFAULT_DRIVER_HOME_HOW_TO } from '../backend/driverUiSettings';
import { pushPassengerHomeMapShortcuts } from '../backend/passengerHomeMapShortcutSync';
import {
  loadPassengerFavorites,
  isFavoriteEnabled,
  favoriteHasConfig,
  type PassengerFavoriteSlot,
  type PassengerFavoriteSnapshot,
} from '../lib/passengerFavorites';
import { TinyHelpButton } from '../ui/TinyHelpButton';
import {
  findPassengerActiveRideShortcut,
  fetchMyRides,
  fetchMyBookings,
} from '../rides/api';
import { supabase } from '../backend/supabase';
import { DEFAULT_RATING_STARS, formatProfileRatingStars } from '../lib/profileRating';
import {
  localCalendarYmd,
  localDayBoundsIso,
  formatDriverRecaudoStat,
} from '../lib/driverEarningsSummary';
import { updateRideStatus } from '../backend/rideStatus';
import {
  loadDriverHomeTemplateRows,
  upsertDriverHomeTemplateRow,
  removeDriverHomeTemplateRow,
  driverTemplateHasConfig,
  driverScheduleLabel,
  getDriverHomeTemplateRow,
  type DriverHomeTemplateRow,
} from '../lib/driverHomeTemplates';
import { appBrand } from '../ui/theme/brand';

const PASSENGER_PAGE_BG = appBrand.colors.background;
const PASSENGER_QUICK_ICON_BG = appBrand.colors.greenLight;

type HomeTabNav = BottomTabNavigationProp<MainTabParamList, 'Home'>;
type ParentNav = { navigate: (name: string, params?: object) => void };

function passengerGreetingLine(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Buenos días';
  if (h >= 12 && h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

function userInitialFromSession(s: SessionProfile | null): string {
  const name = String(s?.full_name ?? '').trim();
  if (name) return name.charAt(0).toUpperCase();
  const em = String(s?.email ?? '').trim();
  if (em) return em.charAt(0).toUpperCase();
  return '?';
}

function rideFromBookingRow(row: Record<string, unknown>): Record<string, unknown> | null {
  const r = row.ride;
  if (Array.isArray(r)) return (r[0] as Record<string, unknown>) ?? null;
  return r && typeof r === 'object' ? (r as Record<string, unknown>) : null;
}

function isHistoryBookingRow(row: Record<string, unknown>, ride: Record<string, unknown> | null): boolean {
  const bst = String(row.status ?? '');
  const rst = ride?.status != null ? String(ride.status) : '';
  if (bst === 'completed' || bst === 'cancelled') return true;
  if (rst === 'completed' || rst === 'cancelled') return true;
  return false;
}

function countActiveBookings(rows: unknown[]): number {
  let n = 0;
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const ride = rideFromBookingRow(row);
    if (!isHistoryBookingRow(row, ride)) n += 1;
  }
  return n;
}

const PASSENGER_ACTION_HELP = {
  agregar:
    'Marcá origen, destino y la hora de llegada deseada en el mapa. Cuando se asigne un móvil te avisamos y vas a poder ver la hora de recogida.',
  buscar:
    'Buscá un viaje por código o nombre de ruta para unirte al que te sirve.',
  viajes:
    'Mirá los viajes publicados con asientos libres. Tocá uno para ver el recorrido y reservar.',
  reservas:
    'Acá ves tus viajes confirmados: móvil asignado, hora de recogida y el estado del viaje.',
  crearViaje:
    'Pedí un viaje nuevo: marcá de dónde salís, a dónde vas y a qué hora querés llegar. Te avisamos al asignarte un móvil y vas a ver la hora de recogida.',
  mensajes:
    'Escribile al conductor sobre tu viaje (encuentro, demoras u otras dudas).',
  solicitudes:
    'Seguí los pedidos que todavía no tienen viaje confirmado. Te avisamos cuando haya un móvil asignado.',
  explorar:
    'Mirá rutas con demanda cerca y viajes publicados. Unite marcando tus puntos en el mapa si aún no tenés una ruta guardada.',
} as const;

function driverCardReady(row: DriverHomeTemplateRow | undefined): boolean {
  return driverTemplateHasConfig(row) && Boolean(row?.tripDisplayName?.trim());
}

export function HomeScreen() {
  const navigation = useNavigation<HomeTabNav>();
  const { session } = useAuth();
  const role = session?.role;
  const flavor = getAppFlavor();
  const isPassengerFlavor = flavor !== 'driver';
  const parentNav = navigation.getParent() as ParentNav | undefined;
  const userId = session?.id ?? '';
  const [activeHomeRideId, setActiveHomeRideId] = useState<string | null>(null);

  const [favorites, setFavorites] = useState<Partial<Record<PassengerFavoriteSlot, PassengerFavoriteSnapshot>>>({});
  const [homeShortcutsVisible, setHomeShortcutsVisible] = useState(true);
  const [favoritesTitle, setFavoritesTitle] = useState<string | null>(null);
  const [favoritesSubtitle, setFavoritesSubtitle] = useState<string | null>(null);
  const [showPassengerHero, setShowPassengerHero] = useState(false);
  const [passengerHeroReady, setPassengerHeroReady] = useState(false);
  const [driverTemplateRows, setDriverTemplateRows] = useState<DriverHomeTemplateRow[]>([]);
  const [homeMessagesBadge, setHomeMessagesBadge] = useState(0);
  const [homeBookingsBadge, setHomeBookingsBadge] = useState(0);
  const [driverTripsCompletedCount, setDriverTripsCompletedCount] = useState(0);
  const [driverRatingAvg, setDriverRatingAvg] = useState(DEFAULT_RATING_STARS);
  const [driverPassengersServedCount, setDriverPassengersServedCount] = useState(0);
  const [driverCollectedTodayGs, setDriverCollectedTodayGs] = useState(0);
  const [driverPendingTripRequestsBadge, setDriverPendingTripRequestsBadge] = useState(0);
  const [driverHomeMessagesBadge, setDriverHomeMessagesBadge] = useState(0);
  const [driverHomeHowTo, setDriverHomeHowTo] = useState(DEFAULT_DRIVER_HOME_HOW_TO);

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

  const syncPassengerHeroVisibility = useCallback(async (title: string, subtitle: string) => {
    const fp = passengerHomeHeroFingerprint({ title, subtitle });
    const dismissed = await isPassengerHomeHeroDismissed(fp);
    setShowPassengerHero(!dismissed);
    setPassengerHeroReady(true);
  }, []);

  const onDismissPassengerHero = useCallback(() => {
    const title = (favoritesTitle ?? DEFAULT_PASSENGER_HOME_FAVORITES_TITLE).trim();
    const subtitle = (favoritesSubtitle ?? DEFAULT_PASSENGER_HOME_FAVORITES_SUBTITLE).trim();
    const fp = passengerHomeHeroFingerprint({ title, subtitle });
    setShowPassengerHero(false);
    void dismissPassengerHomeHero(fp);
  }, [favoritesTitle, favoritesSubtitle]);

  const refreshDriverTemplates = useCallback(() => {
    if (!userId || isPassengerFlavor) return;
    void loadDriverHomeTemplateRows(userId).then(setDriverTemplateRows);
  }, [userId, isPassengerFlavor]);

  const refreshDriverHomeSummary = useCallback(async () => {
    if (!session?.id || isPassengerFlavor) return;
    const uid = session.id;
    const today = localCalendarYmd();
    const { startIso, endIso } = localDayBoundsIso(today);
    try {
      const [convos, todayRidesRes, profileRes, pendingReqRes] = await Promise.all([
        fetchMyConversations(uid),
        supabase
          .from('rides')
          .select('id, status')
          .eq('driver_id', uid)
          .gte('departure_time', startIso)
          .lte('departure_time', endIso),
        supabase.from('profiles').select('rating_average, rating_count').eq('id', uid).maybeSingle(),
        supabase
          .from('trip_requests')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending')
          .gte('requested_date', today),
      ]);

      const todayRows = todayRidesRes.error
        ? []
        : ((todayRidesRes.data ?? []) as Array<{ id?: unknown; status?: unknown }>);
      const completedIds = todayRows
        .filter((r) => String(r.status ?? '') === 'completed')
        .map((r) => String(r.id ?? '').trim())
        .filter(Boolean);
      const allTodayIds = todayRows.map((r) => String(r.id ?? '').trim()).filter(Boolean);

      setDriverTripsCompletedCount(completedIds.length);

      if (completedIds.length === 0) {
        setDriverPassengersServedCount(0);
      } else {
        const { count: bookCount, error: bookErr } = await supabase
          .from('bookings')
          .select('id', { count: 'exact', head: true })
          .in('ride_id', completedIds)
          .neq('status', 'cancelled');
        setDriverPassengersServedCount(!bookErr && typeof bookCount === 'number' ? bookCount : 0);
      }

      if (allTodayIds.length === 0) {
        setDriverCollectedTodayGs(0);
      } else {
        const { data: paidRows, error: paidErr } = await supabase
          .from('bookings')
          .select('price_paid')
          .in('ride_id', allTodayIds)
          .eq('payment_status', 'paid')
          .neq('status', 'cancelled');
        if (paidErr) {
          setDriverCollectedTodayGs(0);
        } else {
          const sum = (paidRows ?? []).reduce(
            (acc, row) => acc + Math.max(0, Math.round(Number((row as { price_paid?: unknown }).price_paid ?? 0))),
            0,
          );
          setDriverCollectedTodayGs(sum);
        }
      }

      const unread = convos.reduce((acc, c) => acc + Math.max(0, Number(c.unread_count) || 0), 0);
      setDriverHomeMessagesBadge(unread);
      const prof = profileRes.data as { rating_average?: number | null; rating_count?: number | null } | null;
      const stars = formatProfileRatingStars(prof?.rating_average, prof?.rating_count);
      setDriverRatingAvg(Number(stars));
      setDriverPendingTripRequestsBadge(typeof pendingReqRes.count === 'number' ? pendingReqRes.count : 0);
    } catch {
      setDriverHomeMessagesBadge(0);
      setDriverTripsCompletedCount(0);
      setDriverRatingAvg(DEFAULT_RATING_STARS);
      setDriverPassengersServedCount(0);
      setDriverCollectedTodayGs(0);
      setDriverPendingTripRequestsBadge(0);
    }
  }, [session?.id, isPassengerFlavor]);

  const goDriverNewRoutePublish = useCallback(() => {
    parentNav?.navigate('PublishRide', {
      createDriverTemplate: true,
      publishKind: 'internal',
    });
  }, [parentNav]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active' && userId) {
        if (isPassengerFlavor) refreshFavorites();
        else refreshDriverTemplates();
      }
    });
    return () => sub.remove();
  }, [userId, isPassengerFlavor, refreshFavorites, refreshDriverTemplates]);

  useFocusEffect(
    useCallback(() => {
      refreshFavorites();
    }, [refreshFavorites])
  );

  useFocusEffect(
    useCallback(() => {
      if (isPassengerFlavor) return;
      refreshDriverTemplates();
      void refreshDriverHomeSummary();
      void (async () => {
        const copy = await fetchDriverHomeHowTo();
        setDriverHomeHowTo(copy);
      })();
    }, [isPassengerFlavor, refreshDriverTemplates, refreshDriverHomeSummary])
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const run = async () => {
        if (!session?.id) {
          if (!cancelled) setActiveHomeRideId(null);
          return;
        }
        if (!isPassengerFlavor) {
          try {
            const rides = await fetchMyRides(session.id);
            const enRoute = rides.find((r: { status?: unknown; id?: unknown }) => String(r.status ?? '') === 'en_route');
            if (!cancelled) setActiveHomeRideId(enRoute ? String(enRoute.id ?? '').trim() || null : null);
          } catch {
            if (!cancelled) setActiveHomeRideId(null);
          }
          return;
        }
        const favoriteSlots = Object.entries(favorites)
          .filter(([, snap]) => favoriteHasConfig(snap) && isFavoriteEnabled(snap))
          .map(([slot]) => String(slot));
        const rideId = await findPassengerActiveRideShortcut({
          userId: session.id,
          favoriteSlots,
        });
        if (!cancelled) setActiveHomeRideId(rideId);
      };
      void run();
      return () => {
        cancelled = true;
      };
    }, [session?.id, isPassengerFlavor, favorites])
  );

  useLayoutEffect(() => {
    if (!isPassengerFlavor) return;
    let cancelled = false;
    void readPassengerHomeFavoritesCopyCache().then((cached) => {
      if (cancelled || !cached) return;
      setFavoritesTitle(cached.title);
      setFavoritesSubtitle(cached.subtitle);
      void syncPassengerHeroVisibility(cached.title, cached.subtitle);
    });
    return () => {
      cancelled = true;
    };
  }, [isPassengerFlavor, syncPassengerHeroVisibility]);

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
          await syncPassengerHeroVisibility(copy.title, copy.subtitle);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [session, isPassengerFlavor, syncPassengerHeroVisibility]),
  );

  useFocusEffect(
    useCallback(() => {
      if (!session?.id || !isPassengerFlavor) return;
      let cancelled = false;
      void (async () => {
        try {
          const [convos, bookings] = await Promise.all([
            fetchMyConversations(session.id),
            fetchMyBookings(session.id),
          ]);
          if (cancelled) return;
          const unread = convos.reduce((acc, c) => acc + Math.max(0, Number(c.unread_count) || 0), 0);
          setHomeMessagesBadge(unread);
          setHomeBookingsBadge(countActiveBookings(bookings));
        } catch {
          if (!cancelled) {
            setHomeMessagesBadge(0);
            setHomeBookingsBadge(0);
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [session?.id, isPassengerFlavor])
  );

  const goToSavedRoutes = useCallback(() => {
    navigation.navigate('SavedRoutes', { openAdd: true });
  }, [navigation]);

  const deleteDriverTemplate = useCallback(
    (id: string, displayName: string) => {
      if (!session || !userId) return;
      const label = displayName.trim() || 'esta plantilla';
      Alert.alert('Eliminar plantilla', `Se borrará «${label}» solo en este dispositivo.`, [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await removeDriverHomeTemplateRow(userId, id);
              const rows = await loadDriverHomeTemplateRows(userId);
              setDriverTemplateRows(rows);
            })();
          },
        },
      ]);
    },
    [session, userId]
  );

  return (
    <ScrollView
      style={[styles.scroll, session ? styles.scrollPassengerPage : null]}
      contentContainerStyle={[styles.scrollContent, session ? styles.scrollContentPassengerPage : null]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {isPassengerFlavor && session ? (
        <View style={styles.passengerShell}>
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

          <View style={styles.homeHeaderRow}>
            <View style={styles.homeHeaderTextCol}>
              <Text style={styles.homeGreetingLine}>
                {passengerGreetingLine()} <Text>👋</Text>
              </Text>
              <Text style={styles.homeGreetingQuestion}>¿A dónde vas hoy?</Text>
            </View>
            <TouchableOpacity
              style={styles.homeAvatar}
              onPress={() => navigation.navigate('Settings')}
              accessibilityRole="button"
              accessibilityLabel="Ajustes y perfil"
            >
              <Text style={styles.homeAvatarLetter}>{userInitialFromSession(session)}</Text>
            </TouchableOpacity>
          </View>

          {passengerHeroReady && showPassengerHero ? (
            <View style={styles.heroCard}>
              <View style={[styles.heroBlob, styles.heroBlob1]} />
              <View style={[styles.heroBlob, styles.heroBlob2]} />
              <TouchableOpacity
                style={styles.heroDismissBtn}
                onPress={onDismissPassengerHero}
                accessibilityRole="button"
                accessibilityLabel="Cerrar anuncio"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={18} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.heroEyebrow}>{PASSENGER_HOME_HERO_EYEBROW}</Text>
              {favoritesTitle ? (
                <Text style={styles.heroTitle} numberOfLines={4}>
                  {favoritesTitle}
                </Text>
              ) : null}
              {favoritesSubtitle ? (
                <Text style={styles.heroSubtitle} numberOfLines={5}>
                  {favoritesSubtitle}
                </Text>
              ) : null}
              <View style={styles.heroCtaRow}>
                <TouchableOpacity
                  style={styles.heroCtaBtn}
                  onPress={goToSavedRoutes}
                  accessibilityRole="button"
                  accessibilityLabel="Programar viaje"
                >
                  <Ionicons name="add" size={22} color={appBrand.colors.primary} />
                  <Text style={styles.heroCtaText}>Programar viaje</Text>
                </TouchableOpacity>
                <TinyHelpButton title="Programar viaje" message={PASSENGER_ACTION_HELP.agregar} onDark />
              </View>
            </View>
          ) : null}

          {activeHomeRideId ? (
            <TouchableOpacity
              style={[styles.activeRideShortcutBtn, styles.activeRideShortcutBtnPassenger]}
              onPress={() => parentNav?.navigate('RideDetail', { rideId: activeHomeRideId })}
              accessibilityRole="button"
              accessibilityLabel="Abrir viaje actual"
            >
              <Ionicons name="navigate-circle-outline" size={20} color="#fff" />
              <Text style={styles.activeRideShortcutBtnText}>Ir a mi viaje actual</Text>
            </TouchableOpacity>
          ) : null}

          <View style={styles.searchCardRow}>
            <TouchableOpacity
              style={styles.searchCard}
              onPress={() => parentNav?.navigate('SearchPublishedRides', {})}
              accessibilityRole="button"
              accessibilityLabel="Buscar viajes"
            >
              <Ionicons name="search" size={20} color="#9ca3af" style={styles.searchCardIcon} />
              <Text style={styles.searchCardPlaceholder}>Buscá un código o ruta…</Text>
            </TouchableOpacity>
            <TinyHelpButton title="Buscar" message={PASSENGER_ACTION_HELP.buscar} />
          </View>

          <View style={styles.primaryActionsWrap}>
            <TouchableOpacity
              style={styles.primaryTile}
              onPress={() => parentNav?.navigate('AvailableRides')}
              accessibilityRole="button"
              accessibilityLabel="Viajes disponibles"
            >
              <View style={styles.primaryIconSquare}>
                <Ionicons name="car" size={30} color={appBrand.colors.primary} />
              </View>
              <Text style={styles.primaryTileLabel}>Viajes</Text>
              <Text style={styles.primaryTileHint}>Publicados con asientos</Text>
              <View style={styles.primaryHelpSlot}>
                <TinyHelpButton title="Viajes" message={PASSENGER_ACTION_HELP.viajes} />
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.primaryTile}
              onPress={() => parentNav?.navigate('MyBookings')}
              accessibilityRole="button"
              accessibilityLabel="Mis reservas"
            >
              {homeBookingsBadge > 0 ? (
                <View style={styles.quickBadge} accessibilityLabel={`${homeBookingsBadge} reservas activas`}>
                  <Text style={styles.quickBadgeText}>{homeBookingsBadge > 99 ? '99+' : homeBookingsBadge}</Text>
                </View>
              ) : null}
              <View style={styles.primaryIconSquare}>
                <Ionicons name="calendar" size={28} color={appBrand.colors.primary} />
              </View>
              <Text style={styles.primaryTileLabel}>Reservas</Text>
              <Text style={styles.primaryTileHint}>Tus viajes confirmados</Text>
              <View style={styles.primaryHelpSlot}>
                <TinyHelpButton title="Reservas" message={PASSENGER_ACTION_HELP.reservas} />
              </View>
            </TouchableOpacity>
          </View>

          {homeShortcutsVisible ? (
              <View style={styles.quickActionsWrap}>
                <Text style={styles.quickActionsTitle}>ACCIONES RÁPIDAS</Text>
                <View style={styles.quickGridRow}>
                  <TouchableOpacity
                    style={styles.quickTile}
                    onPress={() => parentNav?.navigate('SaveTripRequest', undefined)}
                    accessibilityRole="button"
                    accessibilityLabel="Crear viaje o solicitud de trayecto"
                  >
                    <View style={styles.quickIconSquare}>
                      <Ionicons name="add-circle-outline" size={26} color={appBrand.colors.primary} />
                    </View>
                    <View style={styles.quickTileLabelRow}>
                      <Text style={styles.quickTileLabel}>Crear viaje</Text>
                      <TinyHelpButton title="Crear viaje" message={PASSENGER_ACTION_HELP.crearViaje} />
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.quickTile}
                    onPress={() => parentNav?.navigate('Messages')}
                    accessibilityRole="button"
                    accessibilityLabel="Mensajes"
                  >
                    {homeMessagesBadge > 0 ? (
                      <View style={styles.quickBadge} accessibilityLabel={`${homeMessagesBadge} mensajes sin leer`}>
                        <Text style={styles.quickBadgeText}>{homeMessagesBadge > 99 ? '99+' : homeMessagesBadge}</Text>
                      </View>
                    ) : null}
                    <View style={styles.quickIconSquare}>
                      <Ionicons name="chatbubble-ellipses-outline" size={24} color={appBrand.colors.primary} />
                    </View>
                    <View style={styles.quickTileLabelRow}>
                      <Text style={styles.quickTileLabel}>Mensajes</Text>
                      <TinyHelpButton title="Mensajes" message={PASSENGER_ACTION_HELP.mensajes} />
                    </View>
                  </TouchableOpacity>
                </View>
                <View style={styles.quickGridRow}>
                  <TouchableOpacity
                    style={[styles.quickTile, styles.quickTileHalf]}
                    onPress={() => parentNav?.navigate('MyTripRequests')}
                    accessibilityRole="button"
                    accessibilityLabel="Solicitudes"
                  >
                    <View style={styles.quickIconSquare}>
                      <Ionicons name="document-text-outline" size={24} color={appBrand.colors.primary} />
                    </View>
                    <View style={styles.quickTileLabelRow}>
                      <Text style={styles.quickTileLabel}>Solicitudes</Text>
                      <TinyHelpButton title="Solicitudes" message={PASSENGER_ACTION_HELP.solicitudes} />
                    </View>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
        </View>
        ) : null}

        {!isPassengerFlavor && session ? (
          <View style={styles.driverShell}>
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

            <View style={styles.driverHeaderRow}>
              <View style={styles.driverHeaderTextCol}>
                <Text style={styles.driverGreetingMuted}>Bienvenido de vuelta</Text>
                <Text style={styles.driverPanelTitle}>Panel conductor</Text>
              </View>
              <TouchableOpacity
                onPress={() => navigation.navigate('Settings')}
                accessibilityRole="button"
                accessibilityLabel="Ir a ajustes"
                activeOpacity={0.85}
                style={styles.driverAvatarTouch}
              >
                <View style={styles.driverAvatarGradient}>
                  <Text style={styles.driverAvatarLetterWhite}>{userInitialFromSession(session)}</Text>
                </View>
                {driverHomeMessagesBadge + driverPendingTripRequestsBadge > 0 ? (
                  <View style={styles.driverAvatarNotifyDot} />
                ) : null}
              </TouchableOpacity>
            </View>

            <View style={styles.driverStatsRow}>
              <View style={styles.driverStatCard}>
                <Text style={styles.driverStatValue}>{driverTripsCompletedCount}</Text>
                <Text style={styles.driverStatLabel}>Viajes hoy</Text>
              </View>
              <View style={styles.driverStatCard}>
                <Text style={styles.driverStatValue}>{driverRatingAvg.toFixed(1)}★</Text>
                <Text style={styles.driverStatLabel}>Calificación</Text>
              </View>
              <View style={styles.driverStatCard}>
                <Text style={styles.driverStatValue}>{driverPassengersServedCount}</Text>
                <Text style={styles.driverStatLabel}>Pasajeros hoy</Text>
              </View>
              <View style={styles.driverStatCard}>
                <Text
                  style={[styles.driverStatValue, styles.driverStatValueMoney]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                >
                  {formatDriverRecaudoStat(driverCollectedTodayGs)}
                </Text>
                <Text style={styles.driverStatLabel}>Recaudo</Text>
              </View>
            </View>

            {activeHomeRideId ? (
              <TouchableOpacity
                style={[styles.activeRideShortcutBtn, styles.driverActiveRideBtn]}
                onPress={() => parentNav?.navigate('RideDetail', { rideId: activeHomeRideId })}
                accessibilityRole="button"
                accessibilityLabel="Abrir viaje en curso"
              >
                <Ionicons name="navigate-circle" size={22} color="#fff" />
                <Text style={styles.driverActiveRideBtnText}>Viaje en curso — continuar</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              onPress={goDriverNewRoutePublish}
              activeOpacity={0.92}
              style={styles.driverPrimaryGradientOuter}
              accessibilityRole="button"
              accessibilityLabel="Publicar nueva ruta"
            >
              <View style={styles.driverPrimaryGradientInner}>
                <Ionicons name="add" size={22} color="#fff" />
                <Text style={styles.driverPrimaryGradientLabel}>Publicar nueva ruta</Text>
              </View>
            </TouchableOpacity>

            {driverTemplateRows.length > 0 ? (
              <View style={styles.driverTemplatesCard}>
                <Text style={styles.driverTemplatesCardTitle}>Tus rutas</Text>
                <ScrollView
                  style={styles.driverTemplateScroll}
                  contentContainerStyle={styles.favoriteStackContent}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator
                >
                  {driverTemplateRows.map((row) => {
                    const switchOn = Boolean(row.enabled && driverCardReady(row));
                    const title = row.tripDisplayName?.trim() || 'Sin nombre — tocá para configurar';
                    const metaSeats = row.publishSeatCount != null ? `${row.publishSeatCount} cupo(s)` : '—';
                    const metaGs =
                      row.totalCollectGs > 0 ? `${Math.round(row.totalCollectGs).toLocaleString('es-PY')} Gs` : '—';
                    return (
                      <TouchableOpacity
                        key={row.id}
                        style={styles.favoriteRow}
                        onPress={() => {
                          void (async () => {
                            if (!parentNav) return;
                            const publishKind =
                              row.rideKind === 'long_distance' ? 'long_distance' : 'internal';
                            if (!userId) {
                              parentNav.navigate('PublishRide', {
                                driverTemplateId: row.id,
                                publishKind,
                              });
                              return;
                            }
                            try {
                              let editRideId = '';
                              const preferredId = String(row.homeActiveRideId ?? '').trim();
                              if (preferredId) {
                                const { data: preferred } = await supabase
                                  .from('rides')
                                  .select('id, status')
                                  .eq('id', preferredId)
                                  .eq('driver_id', userId)
                                  .maybeSingle();
                                const st = String((preferred as { status?: unknown } | null)?.status ?? '');
                                if (st === 'published' || st === 'booked') {
                                  editRideId = String((preferred as { id?: unknown } | null)?.id ?? '').trim();
                                }
                              }
                              if (!editRideId) {
                                const { data: active } = await supabase
                                  .from('rides')
                                  .select('id')
                                  .eq('driver_id', userId)
                                  .eq('driver_home_template_slot', row.id)
                                  .in('status', ['published', 'booked'])
                                  .order('departure_time', { ascending: true })
                                  .limit(1);
                                editRideId = String((active?.[0] as { id?: unknown } | undefined)?.id ?? '').trim();
                              }
                              if (editRideId) {
                                parentNav.navigate('EditRide', { rideId: editRideId });
                                return;
                              }
                            } catch {
                              // fallback: abrir formulario de publicación
                            }
                            parentNav.navigate('PublishRide', {
                              driverTemplateId: row.id,
                              publishKind,
                            });
                          })();
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Plantilla ${title}`}
                      >
                        <TouchableOpacity
                          style={styles.favoriteDeleteBtn}
                          onPress={() => deleteDriverTemplate(row.id, row.tripDisplayName)}
                          accessibilityRole="button"
                          accessibilityLabel={`Eliminar plantilla ${title}`}
                        >
                          <Ionicons name="close" size={12} color="#b91c1c" />
                        </TouchableOpacity>
                        <View style={styles.favoriteRowLeft}>
                          <View style={styles.favoriteRowTitleRow}>
                            {driverTemplateHasConfig(row) && switchOn ? (
                              <View style={styles.favoriteActiveBadge}>
                                <Text style={styles.favoriteActiveBadgeText}>Activo</Text>
                              </View>
                            ) : null}
                          </View>
                          <Text style={styles.favoriteRowLabel}>{title}</Text>
                          <Text style={styles.favoriteRowTime}>
                            {driverTemplateHasConfig(row) ? driverScheduleLabel(row) : 'Sin configurar'}
                          </Text>
                          <Text style={styles.favoriteRowCostMuted}>
                            Cupos: {metaSeats} · Meta total: {metaGs}
                          </Text>
                        </View>
                        <View
                          style={styles.favoriteRowRight}
                          onStartShouldSetResponder={() => true}
                          onTouchEnd={(e) => e.stopPropagation()}
                        >
                          <Switch
                            value={switchOn}
                            onValueChange={(v) => {
                              if (!userId) return;
                              if (!v) {
                                void (async () => {
                                  const token = session?.access_token?.trim() ?? '';
                                  const { data: hits } = await supabase
                                    .from('rides')
                                    .select('id')
                                    .eq('driver_id', userId)
                                    .eq('driver_home_template_slot', row.id)
                                    .in('status', ['published', 'booked'])
                                    .order('departure_time', { ascending: true });
                                  const ids = (hits ?? [])
                                    .map((h) => String((h as { id?: string }).id ?? '').trim())
                                    .filter(Boolean);
                                  if (ids.length > 0 && !token) {
                                    Alert.alert('Sesión', 'No pudimos cancelar los viajes: iniciá sesión de nuevo.');
                                    return;
                                  }
                                  for (const rideId of ids) {
                                    const res = await updateRideStatus(rideId, 'cancelled', token);
                                    if (!res.ok) {
                                      Alert.alert(
                                        'Cancelar viaje',
                                        res.details ??
                                          res.error ??
                                          'No se pudo cancelar un viaje ligado a esta plantilla.'
                                      );
                                      return;
                                    }
                                  }
                                  await upsertDriverHomeTemplateRow(userId, row.id, {
                                    enabled: false,
                                    homeActiveRideId: null,
                                  });
                                  const rows = await loadDriverHomeTemplateRows(userId);
                                  setDriverTemplateRows(rows);
                                })();
                                return;
                              }
                              if (!driverCardReady(row)) {
                                parentNav?.navigate('PublishRide', {
                                  driverTemplateId: row.id,
                                  publishKind: row.rideKind === 'long_distance' ? 'long_distance' : 'internal',
                                });
                                return;
                              }
                              void (async () => {
                                await upsertDriverHomeTemplateRow(userId, row.id, { bumpScheduleAnchor: true });
                                const rows = await loadDriverHomeTemplateRows(userId);
                                setDriverTemplateRows(rows);
                                const fresh = getDriverHomeTemplateRow(rows, row.id);
                                parentNav?.navigate('PublishRide', {
                                  driverTemplateId: row.id,
                                  publishKind:
                                    (fresh?.rideKind ?? row.rideKind) === 'long_distance'
                                      ? 'long_distance'
                                      : 'internal',
                                  autoPublish: true,
                                });
                              })();
                            }}
                            trackColor={{ false: '#d1d5db', true: '#c6e6d3' }}
                            thumbColor={switchOn ? appBrand.colors.primary : '#f9fafb'}
                          />
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            ) : (
              <>
                <View style={styles.driverEmptyCard}>
                  <View style={styles.driverEmptyIllustration}>
                    <View style={styles.driverEmptyRouteCol}>
                      <View style={styles.driverEmptyRouteDot} />
                      <View style={styles.driverEmptyRouteLine} />
                      <View style={styles.driverEmptyRouteDotSmall} />
                    </View>
                    <Ionicons name="car-sport-outline" size={40} color={appBrand.colors.primary} />
                  </View>
                  <Text style={styles.driverEmptyTitle}>Aún no tenés viajes activos</Text>
                  <Text style={styles.driverEmptySubtitle}>
                    Publicá tu primera ruta y empezá a recibir pasajeros
                  </Text>
                  <TouchableOpacity
                    style={styles.driverEmptyCta}
                    onPress={goDriverNewRoutePublish}
                    accessibilityRole="button"
                    accessibilityLabel="Crear mi primera ruta"
                  >
                    <Ionicons name="add" size={18} color={appBrand.colors.primary} />
                    <Text style={styles.driverEmptyCtaText}>Crear mi primera ruta</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.driverHowToCard}>
                  <Text style={styles.driverHowToKicker}>{driverHomeHowTo.title}</Text>
                  {driverHomeHowTo.lines.map((line, idx) => (
                    <Text key={`howto-${idx}`} style={styles.driverHowToLine}>
                      {line}
                    </Text>
                  ))}
                </View>
              </>
            )}

            <Text style={styles.driverQuickSectionTitle}>ACCIONES RÁPIDAS</Text>
            <View style={styles.quickActionsWrap}>
              <View style={styles.quickGridRow}>
                <TouchableOpacity
                  style={styles.quickTile}
                  onPress={() => parentNav?.navigate('DriverTripRequests')}
                  accessibilityRole="button"
                  accessibilityLabel="Solicitudes de trayecto"
                >
                  {driverPendingTripRequestsBadge > 0 ? (
                    <View
                      style={styles.quickBadge}
                      accessibilityLabel={`${driverPendingTripRequestsBadge} solicitudes pendientes`}
                    >
                      <Text style={styles.quickBadgeText}>
                        {driverPendingTripRequestsBadge > 99 ? '99+' : driverPendingTripRequestsBadge}
                      </Text>
                    </View>
                  ) : null}
                  <View style={styles.quickIconSquare}>
                    <Ionicons name="document-text-outline" size={24} color={appBrand.colors.primary} />
                  </View>
                  <Text style={styles.quickTileLabel}>Solicitudes</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.quickTile}
                  onPress={() => parentNav?.navigate('MyPublishedRides')}
                  accessibilityRole="button"
                  accessibilityLabel="Mis viajes publicados"
                >
                  <View style={styles.quickIconSquare}>
                    <Ionicons name="list-outline" size={24} color={appBrand.colors.primary} />
                  </View>
                  <Text style={styles.quickTileLabel}>Mis viajes</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.quickGridRow}>
                <TouchableOpacity
                  style={styles.quickTile}
                  onPress={() => parentNav?.navigate('Messages')}
                  accessibilityRole="button"
                  accessibilityLabel="Mensajes"
                >
                  {driverHomeMessagesBadge > 0 ? (
                    <View style={styles.quickBadge} accessibilityLabel={`${driverHomeMessagesBadge} sin leer`}>
                      <Text style={styles.quickBadgeText}>
                        {driverHomeMessagesBadge > 99 ? '99+' : driverHomeMessagesBadge}
                      </Text>
                    </View>
                  ) : null}
                  <View style={styles.quickIconSquare}>
                    <Ionicons name="chatbubble-ellipses-outline" size={24} color={appBrand.colors.primary} />
                  </View>
                  <Text style={styles.quickTileLabel}>Mensajes</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.quickTile}
                  onPress={() => navigation.navigate('Settings')}
                  accessibilityRole="button"
                  accessibilityLabel="Panel conductor y cuenta"
                >
                  <View style={styles.quickIconSquare}>
                    <Ionicons name="speedometer-outline" size={24} color={appBrand.colors.primary} />
                  </View>
                  <Text style={styles.quickTileLabel}>Panel conductor</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: appBrand.colors.greenLight },
  scrollContent: { flexGrow: 1, padding: 20, paddingBottom: 32 },
  scrollPassengerPage: { backgroundColor: PASSENGER_PAGE_BG },
  scrollContentPassengerPage: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 28 },
  passengerShell: { flexGrow: 1 },
  driverShell: { flexGrow: 1 },
  driverHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  driverHeaderTextCol: { flex: 1, paddingRight: 12 },
  driverGreetingMuted: {
    fontSize: 13,
    color: '#94a3b8',
    fontFamily: appBrand.fonts.regular,
    marginBottom: 4,
  },
  driverPanelTitle: { fontSize: 24, fontWeight: '800', color: '#111827', fontFamily: appBrand.fonts.semibold },
  driverAvatarTouch: { position: 'relative' },
  driverAvatarGradient: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: appBrand.colors.primary,
  },
  driverAvatarLetterWhite: { fontSize: 20, fontWeight: '800', color: '#fff', fontFamily: appBrand.fonts.semibold },
  driverAvatarNotifyDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ef4444',
    borderWidth: 2,
    borderColor: '#fff',
  },
  driverStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  driverStatCard: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: '46%',
    maxWidth: '48%',
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 6,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  driverStatValue: {
    fontSize: 22,
    fontWeight: '800',
    color: appBrand.colors.primary,
    fontFamily: appBrand.fonts.semibold,
  },
  driverStatValueMoney: {
    fontSize: 18,
  },
  driverStatLabel: { fontSize: 12, color: '#64748b', marginTop: 4, fontFamily: appBrand.fonts.regular },
  driverPrimaryGradientOuter: {
    borderRadius: 18,
    overflow: 'hidden',
    marginBottom: 14,
    shadowColor: 'rgba(26,92,56,0.28)',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 24,
    elevation: 10,
  },
  driverPrimaryGradientInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    paddingHorizontal: 18,
    backgroundColor: appBrand.colors.primary,
  },
  driverPrimaryGradientLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    fontFamily: appBrand.fonts.semibold,
  },
  driverActiveRideBtn: {
    marginBottom: 14,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: '#ea580c',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#c2410c',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  driverActiveRideBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    fontFamily: appBrand.fonts.semibold,
  },
  driverTemplatesCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 14,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  driverTemplatesCardTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#64748b',
    marginBottom: 10,
    letterSpacing: 0.6,
    fontFamily: appBrand.fonts.semibold,
  },
  driverEmptyCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 22,
    marginBottom: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#d1d5db',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  driverEmptyIllustration: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 12 },
  driverEmptyRouteCol: { alignItems: 'center', height: 72, justifyContent: 'space-between', paddingVertical: 2 },
  driverEmptyRouteDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: appBrand.colors.primaryMuted },
  driverEmptyRouteLine: { flex: 1, width: 3, backgroundColor: '#c6e6d3', marginVertical: 4, borderRadius: 2 },
  driverEmptyRouteDotSmall: { width: 6, height: 6, borderRadius: 3, backgroundColor: appBrand.colors.primary },
  driverEmptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
    fontFamily: appBrand.fonts.semibold,
  },
  driverEmptySubtitle: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 16,
    fontFamily: appBrand.fonts.regular,
  },
  driverEmptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: PASSENGER_QUICK_ICON_BG,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 14,
  },
  driverEmptyCtaText: { fontSize: 15, fontWeight: '800', color: appBrand.colors.primary, fontFamily: appBrand.fonts.semibold },
  driverHowToCard: {
    borderRadius: 20,
    padding: 18,
    marginBottom: 18,
    backgroundColor: appBrand.colors.primary,
  },
  driverHowToKicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: 'rgba(255,255,255,0.85)',
    marginBottom: 10,
    fontFamily: appBrand.fonts.semibold,
  },
  driverHowToLine: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    lineHeight: 20,
    marginBottom: 6,
    fontFamily: appBrand.fonts.semibold,
  },
  driverQuickSectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    color: '#94a3b8',
    marginBottom: 10,
    fontFamily: appBrand.fonts.semibold,
  },
  homeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  homeHeaderTextCol: { flex: 1, paddingRight: 12 },
  homeGreetingLine: { fontSize: 22, fontWeight: '700', color: '#111827', fontFamily: appBrand.fonts.semibold },
  homeGreetingQuestion: { fontSize: 15, color: '#64748b', marginTop: 4, fontFamily: appBrand.fonts.regular },
  homeAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: PASSENGER_QUICK_ICON_BG,
    borderWidth: 2,
    borderColor: '#c6e6d3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeAvatarLetter: { fontSize: 18, fontWeight: '800', color: appBrand.colors.primary, fontFamily: appBrand.fonts.semibold },
  heroCard: {
    borderRadius: 22,
    padding: 22,
    marginBottom: 18,
    backgroundColor: appBrand.colors.primary,
    overflow: 'hidden',
    minHeight: 176,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  heroDismissBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 2,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCtaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 16,
  },
  searchCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 16,
  },
  quickTileLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 2,
  },
  heroBlob: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: appBrand.colors.primaryMuted,
    opacity: 0.22,
  },
  heroBlob1: { top: -48, right: -36 },
  heroBlob2: { bottom: -56, left: -44 },
  heroEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: 'rgba(255,255,255,0.72)',
    marginBottom: 8,
    paddingRight: 28,
    fontFamily: appBrand.fonts.semibold,
  },
  heroTitle: { fontSize: 20, fontWeight: '800', color: '#fff', lineHeight: 26, fontFamily: appBrand.fonts.semibold },
  heroSubtitle: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.92)',
    marginTop: 8,
    lineHeight: 20,
    fontFamily: appBrand.fonts.regular,
  },
  heroCtaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    gap: 6,
  },
  heroCtaText: { fontSize: 15, fontWeight: '800', color: appBrand.colors.primary, fontFamily: appBrand.fonts.semibold },
  searchCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#e8eaed',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  searchCardIcon: { marginRight: 12 },
  searchCardPlaceholder: { flex: 1, fontSize: 15, color: '#9ca3af', fontFamily: appBrand.fonts.regular },
  primaryActionsWrap: { flexDirection: 'row', gap: 12, marginBottom: 18 },
  primaryTile: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingTop: 18,
    paddingBottom: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    position: 'relative',
    borderWidth: 2,
    borderColor: '#c6e6d3',
    shadowColor: appBrand.colors.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  primaryIconSquare: {
    width: 58,
    height: 58,
    borderRadius: 18,
    backgroundColor: PASSENGER_QUICK_ICON_BG,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  primaryTileLabel: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
    fontFamily: appBrand.fonts.semibold,
  },
  primaryTileHint: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
    textAlign: 'center',
    fontFamily: appBrand.fonts.regular,
  },
  primaryHelpSlot: { position: 'absolute', top: 8, right: 8 },
  quickActionsWrap: { marginTop: 8, marginBottom: 8 },
  quickActionsTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.9,
    color: '#64748b',
    marginBottom: 12,
    fontFamily: appBrand.fonts.semibold,
  },
  quickGridRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  quickTile: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 10,
    alignItems: 'center',
    position: 'relative',
    borderWidth: 1,
    borderColor: '#eef0f3',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  quickTileHalf: { flexGrow: 0, flexBasis: '48%', maxWidth: '48%' },
  quickIconSquare: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: PASSENGER_QUICK_ICON_BG,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  quickTileLabel: { fontSize: 13, fontWeight: '800', color: '#111827', textAlign: 'center', fontFamily: appBrand.fonts.semibold },
  quickBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  quickBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800', fontFamily: appBrand.fonts.semibold },
  activeRideShortcutBtnPassenger: {
    marginBottom: 14,
    backgroundColor: '#ea580c',
    borderWidth: 2,
    borderColor: '#fff',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
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
  welcomePassenger: { fontSize: 20, fontWeight: '800', color: appBrand.colors.primary, marginBottom: 8, lineHeight: 26 },
  subLead: { fontSize: 14, color: '#4b5563', lineHeight: 21, marginBottom: 14 },
  bannerWarning: { backgroundColor: '#fef3c7', padding: 12, borderRadius: 8, marginBottom: 16, borderWidth: 1, borderColor: '#f59e0b' },
  bannerInfo: { backgroundColor: '#dbeafe', padding: 12, borderRadius: 8, marginBottom: 16, borderWidth: 1, borderColor: '#3b82f6' },
  bannerText: { fontSize: 14, color: '#1f2937' },
  favoritesBox: { borderWidth: 1, borderColor: '#86efac', borderRadius: 14, padding: 14, marginBottom: 16, backgroundColor: appBrand.colors.greenLight },
  favoritesPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: appBrand.colors.primary,
    paddingVertical: 14,
    borderRadius: 10,
    marginBottom: 12,
  },
  favoritesPrimaryIcon: { marginRight: 8 },
  favoritesPrimaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 13, letterSpacing: 0.3 },
  favoriteRowTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 8,
    flexWrap: 'wrap',
  },
  favoriteActiveBadge: {
    backgroundColor: appBrand.colors.greenLight,
    borderWidth: 1,
    borderColor: '#86efac',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  favoriteActiveBadgeText: { fontSize: 11, fontWeight: '700', color: appBrand.colors.primary },
  favoriteStackScroll: { maxHeight: 360 },
  favoriteStackContent: { gap: 8, paddingBottom: 4 },
  favoriteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: appBrand.colors.greenLight,
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
  favoriteRowLabel: { fontSize: 13, fontWeight: '700', color: appBrand.colors.primary, marginTop: 4 },
  favoriteRowTime: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  favoriteRowCost: { fontSize: 12, color: appBrand.colors.primary, marginTop: 2, fontWeight: '700' },
  favoriteRowCostMuted: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  driverTemplateScroll: { maxHeight: 360, marginBottom: 4 },
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
    backgroundColor: appBrand.colors.greenLight,
    borderWidth: 1,
    borderColor: '#86efac',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnMintInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnMintText: { fontSize: 14, fontWeight: '700', color: appBrand.colors.primary },
  activeRideShortcutBtn: {
    marginBottom: 12,
    backgroundColor: '#1d4ed8',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  activeRideShortcutBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});
