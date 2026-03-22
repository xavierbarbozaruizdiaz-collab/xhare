'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { checkLocationPermission, checkNotificationPermission } from '@/lib/mobile/permissions';

type Status = 'granted' | 'denied' | 'prompt' | 'unknown';

export default function PermissionsSettingsPage() {
  const [locationStatus, setLocationStatus] = useState<Status>('unknown');
  const [notificationStatus, setNotificationStatus] = useState<Status>('unknown');

  const refreshStatus = useCallback(async () => {
    const loc = await checkLocationPermission();
    setLocationStatus(loc);
    const web = await checkNotificationPermission();
    const notif =
      web === 'granted' ? 'granted' : web === 'denied' ? 'denied' : 'prompt';
    setNotificationStatus(notif);
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    const onVisible = () => {
      void refreshStatus();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshStatus]);

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
          <h1 className="text-base md:text-lg font-semibold text-gray-900">Permisos del sitio</h1>
          <span className="w-12" />
        </div>
      </header>

      <div className="app-mobile-px py-5 max-w-md mx-auto">
        <p className="text-sm text-gray-600 mb-4">
          En el navegador, los permisos se gestionan desde el ícono de candado o información junto a la
          barra de direcciones. La app instalable para conductores y pasajeros es la de Expo en{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">mobile-app/</code>.
        </p>

        <div className="space-y-3 mb-6">
          <div className="w-full bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-gray-900">Ubicación</p>
              <p className="text-xs text-gray-500 mt-0.5">Mapa y compartir posición en viajes (web)</p>
            </div>
            <span className={`px-2.5 py-1 rounded-lg text-sm shrink-0 ${statusBadgeClass(locationStatus)}`}>
              {statusLabel(locationStatus)}
            </span>
          </div>

          <div className="w-full bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-gray-900">Notificaciones</p>
              <p className="text-xs text-gray-500 mt-0.5">Avisos del navegador cuando el sitio los solicita</p>
            </div>
            <span className={`px-2.5 py-1 rounded-lg text-sm shrink-0 ${statusBadgeClass(notificationStatus)}`}>
              {statusLabel(notificationStatus)}
            </span>
          </div>
        </div>

        <p className="text-sm text-gray-500">
          Seguimiento en segundo plano y ajustes de batería aplican solo a la{' '}
          <strong>app nativa</strong> (APK), no a esta versión web.
        </p>
      </div>
    </div>
  );
}
