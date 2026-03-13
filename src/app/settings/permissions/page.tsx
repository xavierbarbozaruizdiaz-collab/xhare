'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { checkLocationPermission, checkNotificationPermission } from '@/lib/mobile/permissions';
import { isNative } from '@/lib/platform';
import { BackgroundLocation } from '@/lib/capacitor/backgroundLocation';

type Status = 'granted' | 'denied' | 'prompt' | 'unknown';

export default function PermissionsSettingsPage() {
  const [locationStatus, setLocationStatus] = useState<Status>('unknown');
  const [notificationStatus, setNotificationStatus] = useState<Status>('unknown');
  const [native, setNative] = useState(false);

  const refreshStatus = useCallback(async () => {
    const isNativePlatform = await isNative();
    setNative(isNativePlatform);
    const loc = await checkLocationPermission();
    setLocationStatus(loc);
    let notif: Status = 'prompt';
    if (isNativePlatform) {
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        const res = await PushNotifications.checkPermissions();
        notif = res?.receive === 'granted' ? 'granted' : res?.receive === 'denied' ? 'denied' : 'prompt';
      } catch {
        const web = await checkNotificationPermission();
        notif = web === 'granted' ? 'granted' : web === 'denied' ? 'denied' : 'prompt';
      }
    } else {
      const web = await checkNotificationPermission();
      notif = web === 'granted' ? 'granted' : web === 'denied' ? 'denied' : 'prompt';
    }
    setNotificationStatus(notif);
  }, []);

  useEffect(() => {
    let cancelled = false;
    refreshStatus().catch(() => {});
    return () => { cancelled = true; };
  }, [refreshStatus]);

  useEffect(() => {
    const onVisible = () => { void refreshStatus(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshStatus]);

  async function openAppSettings() {
    try {
      await BackgroundLocation.openAppSettings();
    } catch (_) {}
  }

  async function openBatterySettings() {
    try {
      await BackgroundLocation.openBatterySettings();
    } catch (_) {
      await openAppSettings();
    }
  }

  function statusLabel(s: Status): string {
    if (s === 'granted') return 'Concedido';
    if (s === 'denied') return 'No concedido';
    if (s === 'prompt') return 'Sin decidir';
    return '…';
  }

  function statusBadgeClass(s: Status): string {
    if (s === 'granted') return 'bg-green-100 text-green-800 font-semibold';
    if (s === 'denied') return 'bg-amber-100 text-amber-800 font-semibold';
    return 'bg-gray-100 text-gray-600';
  }

  return (
    <div className="min-h-screen bg-gray-50 app-mobile-shell">
      <header className="bg-white border-b border-gray-200 app-mobile-px app-mobile-header sticky top-0 z-40">
        <div className="flex items-center justify-between gap-2 py-3 min-h-[48px]">
          <Link href="/search" className="text-sm font-medium text-green-600 hover:text-green-700">
            ← Volver
          </Link>
          <h1 className="text-base md:text-lg font-semibold text-gray-900">Permisos de la app</h1>
          <span className="w-12" />
        </div>
      </header>

      <div className="app-mobile-px py-5 max-w-md mx-auto">
        <p className="text-sm text-gray-600 mb-4">
          Tocá cada permiso para abrir donde se configura. Al volver a la app se actualiza el estado.
        </p>

        <div className="space-y-3 mb-6">
          <button
            type="button"
            onClick={native ? openAppSettings : undefined}
            className="w-full bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between gap-3 text-left hover:bg-gray-50 active:bg-gray-100 transition"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium text-gray-900">Ubicación</p>
              <p className="text-xs text-gray-500 mt-0.5">Mapa, navegación y compartir posición en viajes</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`px-2.5 py-1 rounded-lg text-sm ${statusBadgeClass(locationStatus)}`}>
                {statusLabel(locationStatus)}
              </span>
              {native && <span className="text-gray-400" aria-hidden>→</span>}
            </div>
          </button>

          <button
            type="button"
            onClick={native ? openAppSettings : undefined}
            className="w-full bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between gap-3 text-left hover:bg-gray-50 active:bg-gray-100 transition"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium text-gray-900">Notificaciones</p>
              <p className="text-xs text-gray-500 mt-0.5">Avisos de viajes, reservas y mensajes</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`px-2.5 py-1 rounded-lg text-sm ${statusBadgeClass(notificationStatus)}`}>
                {statusLabel(notificationStatus)}
              </span>
              {native && <span className="text-gray-400" aria-hidden>→</span>}
            </div>
          </button>

          <button
            type="button"
            onClick={native ? openBatterySettings : undefined}
            className="w-full bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between gap-3 text-left hover:bg-gray-50 active:bg-gray-100 transition"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium text-gray-900">Batería (no optimizar)</p>
              <p className="text-xs text-gray-500 mt-0.5">Para que el viaje siga enviando tu ubicación con la pantalla apagada</p>
            </div>
            {native && <span className="text-gray-400 shrink-0" aria-hidden>→</span>}
          </button>
        </div>

        {native && (
          <button
            type="button"
            onClick={openAppSettings}
            className="w-full inline-flex justify-center items-center px-4 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition"
          >
            Abrir configuración de la app
          </button>
        )}
        {!native && (
          <p className="text-sm text-gray-500">
            En el navegador los permisos se gestionan desde la configuración del sitio. En la app instalada (Android) tocá cada permiso arriba.
          </p>
        )}
      </div>
    </div>
  );
}
