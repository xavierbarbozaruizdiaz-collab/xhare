'use client';

import { useEffect } from 'react';

/**
 * Red de seguridad para Android: en Capacitor algunos plugins devuelven un proxy
 * que lanza ".then() is not implemented on android" al ser await. Aunque el código
 * use unwrapPluginResult(), el dispositivo puede estar ejecutando JS en caché (app
 * carga desde Vercel). Este handler evita que ese rechazo de promesa se muestre
 * como "Uncaught" y no interrumpe la app.
 * Enfoque PM senior: mitigar en cliente mientras el caché/despliegue se resuelve.
 */
export default function CapacitorPromiseShim() {
  useEffect(() => {
    const handler = (e: PromiseRejectionEvent) => {
      const msg = String(e.reason?.message ?? e.reason ?? '').toLowerCase();
      if (msg.includes('then') && msg.includes('not implemented') && (msg.includes('android') || msg.includes('on android'))) {
        e.preventDefault();
        e.stopPropagation();
        return true;
      }
      return false;
    };
    window.addEventListener('unhandledrejection', handler, true);
    return () => window.removeEventListener('unhandledrejection', handler, true);
  }, []);
  return null;
}
