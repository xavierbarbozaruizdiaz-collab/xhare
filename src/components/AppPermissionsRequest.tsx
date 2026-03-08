'use client';

import { useEffect, useRef } from 'react';

/**
 * Solicita permisos de ubicación, overlay (burbuja) y batería al entrar en la app, solo en native.
 * Así el usuario no los ve por primera vez al pulsar "Iniciar viaje".
 */
export default function AppPermissionsRequest() {
  const requested = useRef(false);

  useEffect(() => {
    if (requested.current) return;
    const run = async () => {
      if (typeof window === 'undefined') return;
      try {
        const { isNative, requestLocationPermission, requestOverlayPermission, requestBatteryPermission } = await import(
          '@/lib/platform'
        );
        if (!(await isNative())) return;
        requested.current = true;
        await requestLocationPermission();
        await requestOverlayPermission();
        await requestBatteryPermission();
      } catch (_) {
        // No bloquear la app si falla
      }
    };
    const t = setTimeout(run, 1500);
    return () => clearTimeout(t);
  }, []);

  return null;
}
