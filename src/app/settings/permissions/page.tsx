'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { checkLocationPermission, checkNotificationPermission } from '@/lib/mobile/permissions';
import { isNative } from '@/lib/platform';
import { BackgroundLocation } from '@/lib/capacitor/backgroundLocation';

type Status = 'granted' | 'denied' | 'prompt' | 'unknown';

export default function PermissionsSettingsPage() {
  const [locationStatus, setLocationStatus] = useState<Status>('unknown');
  const [notificationStatus, setNotificationStatus] = useState<Status>('unknown');
  const [native, setNative] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const isNativePlatform = await isNative();
      if (cancelled) return;
      setNative(isNativePlatform);
      const loc = await checkLocationPermission();
      if (cancelled) return;
      setLocationStatus(loc);
      const notif = await checkNotificationPermission();
      if (cancelled) return;
      setNotificationStatus(notif === 'granted' ? 'granted' : notif === 'denied' ? 'denied' : 'prompt');
    })();
    return () => { cancelled = true; };
  }, []);

  async function openSystemSettings() {
    try {
      await BackgroundLocation.openAppSettings();
    } catch (_) {}
  }

  function statusLabel(s: Status): string {
    if (s === 'granted') return 'Concedido';
    if (s === 'denied') return 'No concedido';
    if (s === 'prompt') return 'Sin decidir';
    return '—';
  }

  function statusColor(s: Status): string {
    if (s === 'granted') return 'text-green-700';
    if (s === 'denied') return 'text-amber-700';
    return 'text-gray-600';
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
          Para que la app funcione bien en tu celular necesitamos estos permisos. Podés activarlos o revisarlos desde la configuración del teléfono.
        </p>

        <div className="space-y-3 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between gap-3">
            <div>
              <p className="font-medium text-gray-900">Ubicación</p>
              <p className="text-xs text-gray-500 mt-0.5">Mapa, navegación y compartir posición en viajes</p>
            </div>
            <span className={`text-sm font-medium shrink-0 ${statusColor(locationStatus)}`}>
              {statusLabel(locationStatus)}
            </span>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between gap-3">
            <div>
              <p className="font-medium text-gray-900">Notificaciones</p>
              <p className="text-xs text-gray-500 mt-0.5">Avisos de viajes, reservas y mensajes</p>
            </div>
            <span className={`text-sm font-medium shrink-0 ${statusColor(notificationStatus)}`}>
              {statusLabel(notificationStatus)}
            </span>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between gap-3">
            <div>
              <p className="font-medium text-gray-900">Batería (no optimizar)</p>
              <p className="text-xs text-gray-500 mt-0.5">Para que el viaje siga enviando tu ubicación con la pantalla apagada</p>
            </div>
            <span className="text-sm font-medium text-gray-600 shrink-0">Configurable en Ajustes</span>
          </div>
        </div>

        {native && (
          <button
            type="button"
            onClick={openSystemSettings}
            className="w-full inline-flex justify-center items-center px-4 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition"
          >
            Abrir configuración del teléfono
          </button>
        )}
        {!native && (
          <p className="text-sm text-gray-500">
            En el navegador los permisos se gestionan desde la configuración del sitio. En la app instalada (Android) usá el botón de arriba.
          </p>
        )}
      </div>
    </div>
  );
}
