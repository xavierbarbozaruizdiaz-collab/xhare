'use client';

import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase/client';

/**
 * Solicita permisos de ubicación, overlay (burbuja) y batería solo en app nativa
 * y solo después de que el usuario haya iniciado sesión (una vez por usuario).
 * Ver docs/PERMISOS_APP_NATIVA.md.
 */
export default function AppPermissionsRequest() {
  const requestedForUser = useRef<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const runIfLoggedIn = async () => {
      if (typeof window === 'undefined') return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user?.id) return;
        if (requestedForUser.current === session.user.id) return;

        const { isNative } = await import('@/lib/platform');
        const permissions = await import('@/lib/mobile/permissions');
        if (!(await isNative())) return;

        requestedForUser.current = session.user.id;
        await permissions.requestLocationPermission();
        await permissions.requestOverlayPermission();
        await permissions.requestBatteryOptimization();
      } catch (_) {
        requestedForUser.current = null;
      }
    };

    const scheduleRun = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => runIfLoggedIn().catch(() => {}), 1500);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user?.id) return;
      if (requestedForUser.current === session.user.id) return;
      scheduleRun();
    });

    // Por si ya había sesión al montar (p. ej. refresh con usuario logueado)
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.id && requestedForUser.current !== session.user.id) scheduleRun();
    });

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      subscription.unsubscribe();
    };
  }, []);

  return null;
}
