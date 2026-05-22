/**
 * Si hay viaje en_route: al abrir la app o volver del background, ir a RideDetail
 * (cualquier pantalla; sin umbral de tiempo).
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { NavigationContainerRef } from '@react-navigation/native';
import { useAuth } from '../auth/AuthContext';
import { findActiveEnRouteRideIdForUser } from '../lib/activeRideResume';
import type { RootStackParamList } from '../navigation/types';

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
};

export function ActiveRideResumeGate({ navRef }: Props) {
  const { session } = useAuth();
  const busyRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const navigateToRide = useCallback(
    (rideId: string) => {
      if (!navRef.isReady?.()) return false;
      const current = getFocusedRideDetailId(navRef);
      if (current === rideId) return true;
      navRef.navigate('Main', { screen: 'RideDetail', params: { rideId } });
      return true;
    },
    [navRef]
  );

  const resumeActiveRideIfAny = useCallback(async () => {
    if (!session?.id || busyRef.current) return;
    if (!navRef.isReady?.()) return;

    busyRef.current = true;
    try {
      const lastNotif = await Notifications.getLastNotificationResponseAsync();
      if (lastNotif) {
        const data = (lastNotif.notification.request.content.data as Record<string, unknown>) ?? {};
        const rideFromNotif = notificationTargetsRide(data);
        if (rideFromNotif) {
          navigateToRide(rideFromNotif);
          return;
        }
      }

      const rideId = await findActiveEnRouteRideIdForUser(session.id);
      if (rideId) navigateToRide(rideId);
    } finally {
      busyRef.current = false;
    }
  }, [session?.id, navRef, navigateToRide]);

  useEffect(() => {
    if (!session?.id) return;

    const runWhenReady = () => {
      if (!navRef.isReady?.()) {
        setTimeout(runWhenReady, 120);
        return;
      }
      void resumeActiveRideIfAny();
    };
    runWhenReady();
  }, [session?.id, navRef, resumeActiveRideIfAny]);

  useEffect(() => {
    if (!session?.id) return;

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (prev.match(/inactive|background/) && next === 'active') {
        const run = () => {
          if (!navRef.isReady?.()) {
            setTimeout(run, 120);
            return;
          }
          void resumeActiveRideIfAny();
        };
        run();
      }
    });
    return () => sub.remove();
  }, [session?.id, navRef, resumeActiveRideIfAny]);

  return null;
}
