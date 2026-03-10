'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';

/**
 * Solicita permisos de ubicación, overlay (burbuja) y batería solo en app nativa
 * y solo después de que el usuario haya iniciado sesión (una vez por usuario).
 * Pide confirmación antes de abrir pantallas de configuración; solo pide lo que falta.
 * Ver docs/PERMISOS_APP_NATIVA.md.
 */
export default function AppPermissionsRequest() {
  const requestedForUser = useRef<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const pendingSessionUserId = useRef<string | null>(null);
  const STORAGE_KEY_LOCATION_PREFIX = 'xhare_permissions_location_done_user_';
  const STORAGE_KEY_DRIVER_PREFIX = 'xhare_permissions_driver_flow_done_user_';

  const runPermissionFlow = async () => {
    if (!pendingSessionUserId.current) return;
    const userId = pendingSessionUserId.current;
    const locationKey = `${STORAGE_KEY_LOCATION_PREFIX}${userId}`;
    const driverKey = `${STORAGE_KEY_DRIVER_PREFIX}${userId}`;
    try {
      const permissions = await import('@/lib/mobile/permissions');
      const { data: { user } } = await supabase.auth.getUser();
      const roles = (user as any)?.user_metadata?.roles as string[] | undefined;
      const isDriver = Array.isArray(roles) && roles.includes('driver');

      // 1) Ubicación: pedir si falta (para todos)
      if ((await permissions.checkLocationPermission()) !== 'granted') {
        await permissions.requestLocationPermission();
      }

      // 2) Si es conductor: pedir también overlay y batería aquí, una vez
      if (isDriver) {
        await permissions.ensureOverlayPermission();
        await permissions.requestBatteryOptimization();
      }

      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(locationKey, '1');
          if (isDriver) {
            window.localStorage.setItem(driverKey, '1');
          }
        } catch {
          // ignore
        }
      }
    } catch (_) {}
    pendingSessionUserId.current = null;
  };

  useEffect(() => {
    const runIfLoggedIn = async () => {
      if (typeof window === 'undefined') return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user?.id) return;
        if (requestedForUser.current === session.user.id) return;

        const locationKey = `${STORAGE_KEY_LOCATION_PREFIX}${session.user.id}`;
        const driverKey = `${STORAGE_KEY_DRIVER_PREFIX}${session.user.id}`;
        if (typeof window !== 'undefined') {
          try {
            const locationDone = window.localStorage.getItem(locationKey) === '1';
            const driverDone = window.localStorage.getItem(driverKey) === '1';
            if (locationDone && driverDone) {
              requestedForUser.current = session.user.id;
              return;
            }
          } catch {
            // ignore storage errors and fall back to runtime-only guard
          }
        }

        const { isNative } = await import('@/lib/platform');
        if (!(await isNative())) return;

        requestedForUser.current = session.user.id;
        pendingSessionUserId.current = session.user.id;
        setShowConfirmModal(true);
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

  return showConfirmModal ? (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50" role="dialog" aria-modal="true" aria-labelledby="permissions-confirm-title">
      <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6">
        <h2 id="permissions-confirm-title" className="text-lg font-semibold text-gray-900 mb-2">Permisos de la app</h2>
        <p className="text-sm text-gray-600 mb-4">
          Para que los viajes funcionen bien (ubicación, burbuja en curso, batería) podemos revisar los permisos ahora. Podés aceptar cada uno o ir a configuración cuando lo pida el sistema.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { setShowConfirmModal(false); pendingSessionUserId.current = null; }}
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50"
          >
            Más tarde
          </button>
          <button
            type="button"
            onClick={() => { setShowConfirmModal(false); runPermissionFlow(); }}
            className="flex-1 px-4 py-2 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700"
          >
            Continuar
          </button>
        </div>
      </div>
    </div>
  ) : null;
}
