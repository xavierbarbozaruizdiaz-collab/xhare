'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { NavigationPreference, NavigationAppOption } from '@/lib/platform';
import { getAvailableNavigationApps, getNavigationPreference, setNavigationPreference } from '@/lib/platform';

export default function NavigationPreferencePage() {
  const [apps, setApps] = useState<NavigationAppOption[]>([]);
  const [current, setCurrent] = useState<NavigationPreference>('ask_every_time');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<'guardado' | 'error' | null>(null);
  const [pluginError, setPluginError] = useState<string | null>(null);

  const loadPreferenceAndApps = useCallback(async () => {
    setPluginError(null);
    try {
      const [avail, pref] = await Promise.all([
        getAvailableNavigationApps(),
        getNavigationPreference(),
      ]);
      setApps(avail);
      const availableList = avail.filter((a) => a.available);
      const chosen = availableList.find((a) => a.id === pref);
      setCurrent(chosen ? pref : (availableList[0]?.id ?? 'ask_every_time'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo cargar la preferencia.';
      setPluginError(msg);
      setApps([
        { id: 'browser', label: 'Navegador', available: true },
        { id: 'ask_every_time', label: 'Preguntar cada vez', available: true },
      ]);
      setCurrent('ask_every_time');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadPreferenceAndApps().catch(() => { if (!cancelled) setCurrent('ask_every_time'); });
    return () => { cancelled = true; };
  }, [loadPreferenceAndApps]);

  // Al volver a esta pantalla (p. ej. tras "Volver"), refrescar preferencia y lista
  useEffect(() => {
    const onVisible = () => void loadPreferenceAndApps();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadPreferenceAndApps]);

  async function handleChange(pref: NavigationPreference) {
    setSaving(true);
    setMessage(null);
    try {
      await setNavigationPreference(pref);
      const saved = await getNavigationPreference();
      setCurrent(saved);
      setMessage('guardado');
      setTimeout(() => setMessage(null), 2500);
    } catch (e) {
      setMessage('error');
      if (e instanceof Error) setPluginError(e.message);
      setTimeout(() => setMessage(null), 3000);
    } finally {
      setSaving(false);
    }
  }

  // Solo mostrar opciones que el dispositivo puede usar (detectadas + Navegador + Preguntar cada vez)
  const visibleApps: NavigationAppOption[] =
    apps.length > 0
      ? apps.filter((opt) => opt.available)
      : [
          { id: 'browser', label: 'Navegador', available: true },
          { id: 'ask_every_time', label: 'Preguntar cada vez', available: true },
        ];

  return (
    <div className="min-h-screen bg-gray-50 app-mobile-shell">
      <header className="bg-white border-b border-gray-200 app-mobile-px app-mobile-header sticky top-0 z-40">
        <div className="flex items-center justify-between gap-2 py-3 min-h-[48px]">
          <Link href="/search" className="text-sm font-medium text-green-600 hover:text-green-700">
            ← Volver
          </Link>
          <h1 className="text-base md:text-lg font-semibold text-gray-900">Preferencia de navegación</h1>
          <span className="w-12" />
        </div>
      </header>

      <div className="app-mobile-px py-5 max-w-md mx-auto">
        <p className="text-sm text-gray-600 mb-4">
          Elegí la app que querés usar para navegar hacia los puntos del viaje.
        </p>
        {pluginError && (
          <p className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800" role="alert">
            {pluginError} Usá el APK de Xhare instalado en el dispositivo para que la preferencia se guarde y la navegación se abra en la app elegida.
          </p>
        )}
        <div className="space-y-3">
          {visibleApps.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleChange(opt.id)}
              disabled={saving}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-medium ${
                current === opt.id
                  ? 'border-green-600 bg-green-50 text-green-800'
                  : 'border-gray-200 bg-white text-gray-800'
              } hover:bg-gray-50`}
            >
              <span>{opt.label}</span>
              <span className="ml-3">{current === opt.id ? '✓' : ''}</span>
            </button>
          ))}
        </div>
        {message === 'guardado' && (
          <p className="mt-4 text-sm text-green-600 font-medium" role="status">
            Guardado. Se usará esta opción al tocar &quot;Ir al punto actual&quot; o &quot;Continuar viaje&quot;.
          </p>
        )}
        {message === 'error' && (
          <p className="mt-4 text-sm text-red-600" role="alert">
            No se pudo guardar. Volvé a intentar.
          </p>
        )}
        <p className="mt-4 text-xs text-gray-500">
          En web o si no hay apps compatibles disponibles, usaremos siempre el navegador.
        </p>
      </div>
    </div>
  );
}

