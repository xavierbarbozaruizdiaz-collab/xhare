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

  const runPermissionFlow = async () => {
    if (!pendingSessionUserId.current) return;
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      const permissions = await import('@/lib/mobile/permissions');
      // Solo pedir lo que falta; pausa breve entre cada uno para no saturar
      if ((await permissions.checkLocationPermission()) !== 'granted') {
        await permissions.requestLocationPermission();
        await delay(400);
      }
      if (!(await permissions.checkOverlayPermission())) {
        await permissions.requestOverlayPermission();
        await delay(400);
      }
      await permissions.requestBatteryOptimization();
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
