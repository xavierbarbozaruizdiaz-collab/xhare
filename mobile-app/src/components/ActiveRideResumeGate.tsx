/**
 * Si hay viaje en_route: al abrir la app o volver del background, ir a RideDetail
 * (cualquier pantalla; sin umbral de tiempo).
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import { CommonActions, type NavigationContainerRef } from '@react-navigation/native';
import { useAuth } from '../auth/AuthContext';
import { findActiveEnRouteRideIdForUser } from '../lib/activeRideResume';
import type { RootStackParamList } from '../navigation/types';

const NAV_RETRY_MS = 120;
const NAV_MAX_ATTEMPTS = 12;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function notificationTargetsRide(data: Record<string, unknown>): string | null {
  if (typeof data?.rideId === 'string' && data.rideId.trim()) return data.rideId.trim();
  return null;
}

function getFocusedRideDetailId(navRef: NavigationContainerRef<RootStackParamList>): string | null {
  try {
    const root = navRef.getRootState();
    const mainRoute = root?.routes?.find((r) => r.name === 'Main');
    const mainState = mainRoute?.state;
    if (!mainState || mainState.index == null) return null;
    const focused = mainState.routes[mainState.index];
    if (focused?.name !== 'RideDetail') return null;
    const params = focused.params as { rideId?: string } | undefined;
    const id = params?.rideId != null ? String(params.rideId).trim() : '';
    return id || null;
  } catch {
    return null;
  }
}

type Props = {
  navRef: NavigationContainerRef<RootStackParamList>;
  navigationReady: boolean;
};

export function ActiveRideResumeGate({ navRef, navigationReady }: Props) {
  const { session } = useAuth();
  const busyRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const navigateToRide = useCallback(
    (rideId: string): boolean => {
      if (!navRef.isReady?.()) return false;
      const current = getFocusedRideDetailId(navRef);
      if (current === rideId) return true;
      navRef.dispatch(
        CommonActions.navigate({
          name: 'Main',
          params: {
            screen: 'RideDetail',
            params: { rideId },
          },
        })
      );
      return true;
    },
    [navRef]
  );

  const resumeActiveRideIfAny = useCallback(async () => {
    if (!session?.id || busyRef.current || !navigationReady) return;
    if (!navRef.isReady?.()) return;

    busyRef.current = true;
    try {
      const lastNotif = await Notifications.getLastNotificationResponseAsync();
      if (lastNotif) {
        const data = (lastNotif.notification.request.content.data as Record<string, unknown>) ?? {};
        const rideFromNotif = notificationTargetsRide(data);
        if (rideFromNotif) {
          for (let i = 0; i < NAV_MAX_ATTEMPTS; i++) {
            if (!navRef.isReady?.()) {
              await sleep(NAV_RETRY_MS);
              continue;
            }
            if (navigateToRide(rideFromNotif)) return;
            await sleep(NAV_RETRY_MS);
          }
          return;
        }
      }

      const rideId = await findActiveEnRouteRideIdForUser(session.id);
      if (!rideId) return;

      for (let i = 0; i < NAV_MAX_ATTEMPTS; i++) {
        if (!navRef.isReady?.()) {
          await sleep(NAV_RETRY_MS);
          continue;
        }
        navigateToRide(rideId);
        if (getFocusedRideDetailId(navRef) === rideId) return;
        await sleep(NAV_RETRY_MS);
      }
    } finally {
      busyRef.current = false;
    }
  }, [session?.id, navRef, navigationReady, navigateToRide]);

  useEffect(() => {
    if (!session?.id || !navigationReady) return;
    void resumeActiveRideIfAny();
  }, [session?.id, navigationReady, resumeActiveRideIfAny]);

  useEffect(() => {
    if (!session?.id || !navigationReady) return;

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (prev.match(/inactive|background/) && next === 'active') {
        void resumeActiveRideIfAny();
      }
    });
    return () => sub.remove();
  }, [session?.id, navigationReady, resumeActiveRideIfAny]);

  return null;
}
