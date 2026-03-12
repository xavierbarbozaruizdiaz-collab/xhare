'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { NavigationPreference, NavigationAppOption } from '@/lib/platform';
import { getAvailableNavigationApps, getNavigationPreference, setNavigationPreference } from '@/lib/platform';

export default function NavigationPreferencePage() {
  const [apps, setApps] = useState<NavigationAppOption[]>([]);
  const [current, setCurrent] = useState<NavigationPreference>('ask_every_time');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [avail, pref] = await Promise.all([
        getAvailableNavigationApps(),
        getNavigationPreference(),
      ]);
      if (cancelled) return;
      setApps(avail);
      setCurrent(pref);
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleChange(pref: NavigationPreference) {
    setCurrent(pref);
    setSaving(true);
    try {
      await setNavigationPreference(pref);
    } finally {
      setSaving(false);
    }
  }

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
        <div className="space-y-3">
          {apps.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleChange(opt.id)}
              disabled={!opt.available || saving}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-medium ${
                current === opt.id
                  ? 'border-green-600 bg-green-50 text-green-800'
                  : 'border-gray-200 bg-white text-gray-800'
              } ${!opt.available ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'}`}
            >
              <span>
                {opt.label}
                {!opt.available && opt.id !== 'browser' && (
                  <span className="ml-1 text-xs text-gray-500">(no instalada)</span>
                )}
              </span>
              <span className="ml-3">
                {current === opt.id ? '✓' : ''}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-4 text-xs text-gray-500">
          En web o si no hay apps compatibles disponibles, usaremos siempre el navegador.
        </p>
      </div>
    </div>
  );
}

