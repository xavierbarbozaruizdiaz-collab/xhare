'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';

const KEY = 'driver_pending_instructions';
const SHORTCUTS_KEY = 'passenger_home_shortcuts_visible';
const FAVORITES_TITLE_KEY = 'passenger_home_favorites_title';
const FAVORITES_SUBTITLE_KEY = 'passenger_home_favorites_subtitle';

function parseShortcutsVisible(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  return true;
}

export default function AdminSettingsPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const [shortcutsVisible, setShortcutsVisible] = useState(true);
  const [shortcutsLoading, setShortcutsLoading] = useState(true);
  const [shortcutsSaving, setShortcutsSaving] = useState(false);
  const [shortcutsDone, setShortcutsDone] = useState(false);
  const [favoritesTitle, setFavoritesTitle] = useState('');
  const [favoritesSubtitle, setFavoritesSubtitle] = useState('');
  const [favoritesCopyLoading, setFavoritesCopyLoading] = useState(true);
  const [favoritesCopySaving, setFavoritesCopySaving] = useState(false);
  const [favoritesCopyDone, setFavoritesCopyDone] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('settings').select('value').eq('key', KEY).maybeSingle();
      const v = (data?.value as { email?: string; message?: string }) ?? {};
      setEmail(typeof v.email === 'string' ? v.email : '');
      setMessage(typeof v.message === 'string' ? v.message : '');
    })().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('settings').select('value').eq('key', SHORTCUTS_KEY).maybeSingle();
      setShortcutsVisible(parseShortcutsVisible(data?.value));
    })().finally(() => setShortcutsLoading(false));
  }, []);

  useEffect(() => {
    (async () => {
      const [titleRes, subtitleRes] = await Promise.all([
        supabase.from('settings').select('value').eq('key', FAVORITES_TITLE_KEY).maybeSingle(),
        supabase.from('settings').select('value').eq('key', FAVORITES_SUBTITLE_KEY).maybeSingle(),
      ]);
      const titleRaw = titleRes.data?.value;
      const subtitleRaw = subtitleRes.data?.value;
      setFavoritesTitle(typeof titleRaw === 'string' ? titleRaw : '');
      setFavoritesSubtitle(typeof subtitleRaw === 'string' ? subtitleRaw : '');
    })().finally(() => setFavoritesCopyLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setDone(false);
    const value = { email: email.trim(), message: message.trim() };
    const { error } = await supabase
      .from('settings')
      .upsert({ key: KEY, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    setSaving(false);
    if (error) {
      const updateRes = await supabase.from('settings').update({ value, updated_at: new Date().toISOString() }).eq('key', KEY);
      if (updateRes.error) alert(updateRes.error.message);
      else setDone(true);
    } else {
      setDone(true);
    }
  }

  async function handleShortcutsToggle(next: boolean) {
    const prev = shortcutsVisible;
    setShortcutsVisible(next);
    setShortcutsSaving(true);
    setShortcutsDone(false);
    const row = { key: SHORTCUTS_KEY, value: next, updated_at: new Date().toISOString() };
    let { error } = await supabase.from('settings').upsert(row, { onConflict: 'key' });
    if (error) {
      const updateRes = await supabase.from('settings').update({ value: next, updated_at: row.updated_at }).eq('key', SHORTCUTS_KEY);
      error = updateRes.error;
    }
    setShortcutsSaving(false);
    if (error) {
      setShortcutsVisible(prev);
      alert(error.message);
    } else {
      setShortcutsDone(true);
      window.setTimeout(() => setShortcutsDone(false), 2500);
    }
  }

  async function handleFavoritesCopySave(e: React.FormEvent) {
    e.preventDefault();
    setFavoritesCopySaving(true);
    setFavoritesCopyDone(false);
    const nowIso = new Date().toISOString();
    const rows = [
      { key: FAVORITES_TITLE_KEY, value: favoritesTitle.trim(), updated_at: nowIso },
      { key: FAVORITES_SUBTITLE_KEY, value: favoritesSubtitle.trim(), updated_at: nowIso },
    ];

    let { error } = await supabase.from('settings').upsert(rows, { onConflict: 'key' });
    if (error) {
      const [titleUpdate, subtitleUpdate] = await Promise.all([
        supabase.from('settings').update({ value: favoritesTitle.trim(), updated_at: nowIso }).eq('key', FAVORITES_TITLE_KEY),
        supabase.from('settings').update({ value: favoritesSubtitle.trim(), updated_at: nowIso }).eq('key', FAVORITES_SUBTITLE_KEY),
      ]);
      error = titleUpdate.error ?? subtitleUpdate.error ?? null;
    }

    setFavoritesCopySaving(false);
    if (error) {
      alert(error.message);
      return;
    }
    setFavoritesCopyDone(true);
    window.setTimeout(() => setFavoritesCopyDone(false), 2500);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Configuración</h1>
      <p className="text-gray-600 mb-6">
        Texto e email que ven los conductores con solicitud pendiente de aprobación (después de cargar el vehículo).
      </p>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-xl">
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Correo para recibir documentos</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ej. documentos@xhare.com"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          />
          <p className="text-xs text-gray-500 mt-1">Los conductores verán este correo para enviar el resto de documentos.</p>
        </div>
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">Mensaje para conductores pendientes</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder="Enviá el resto de los documentos por correo..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
        >
          {saving ? 'Guardando...' : 'Guardar'}
        </button>
        {done && <span className="ml-3 text-sm text-green-600">Guardado.</span>}
      </form>

      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-xl mt-10">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">App pasajero — Inicio</h2>
        <p className="text-sm text-gray-600 mb-5">
          Ocultá o mostrá el bloque de abajo en la pantalla Inicio (buscador, accesos a Buscar viajes / reservas /
          mensajes / solicitudes, enlaces a Viajes disponibles y En curso cerca, y la sección Alertas importantes). Los
          favoritos (casa / gym / trabajo) siempre se muestran.
        </p>
        {shortcutsLoading ? (
          <div className="flex justify-center py-6">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" />
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              role="switch"
              aria-checked={shortcutsVisible}
              disabled={shortcutsSaving}
              onClick={() => void handleShortcutsToggle(!shortcutsVisible)}
              className={`relative inline-flex h-8 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 ${
                shortcutsVisible ? 'bg-green-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition ${
                  shortcutsVisible ? 'translate-x-6' : 'translate-x-0.5'
                }`}
                style={{ marginTop: '1px' }}
              />
            </button>
            <div className="flex-1 min-w-[200px]">
              <p className="text-sm font-medium text-gray-900">
                {shortcutsVisible ? 'Buscador y accesos visibles' : 'Buscador y accesos ocultos'}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Los cambios aplican al abrir o volver a Inicio en la app (sesión iniciada).
              </p>
            </div>
            {shortcutsSaving && <span className="text-sm text-gray-500">Guardando…</span>}
            {shortcutsDone && !shortcutsSaving && <span className="text-sm text-green-600">Guardado en Supabase.</span>}
          </div>
        )}
      </div>

      <form onSubmit={handleFavoritesCopySave} className="bg-white rounded-xl border border-gray-200 p-6 max-w-xl mt-10">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">App pasajero — Textos de favoritos</h2>
        <p className="text-sm text-gray-600 mb-5">
          Editá los textos que aparecen arriba del bloque de favoritos en la pantalla Inicio.
        </p>
        {favoritesCopyLoading ? (
          <div className="flex justify-center py-6">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" />
          </div>
        ) : (
          <>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Título</label>
              <input
                type="text"
                value={favoritesTitle}
                onChange={(e) => setFavoritesTitle(e.target.value)}
                placeholder="Hola. Configura tus favoritos para viajes rapidos."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
              <textarea
                value={favoritesSubtitle}
                onChange={(e) => setFavoritesSubtitle(e.target.value)}
                rows={3}
                placeholder="Lista apilada con switch..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <button
              type="submit"
              disabled={favoritesCopySaving}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {favoritesCopySaving ? 'Guardando...' : 'Guardar textos'}
            </button>
            {favoritesCopyDone && <span className="ml-3 text-sm text-green-600">Guardado en Supabase.</span>}
          </>
        )}
      </form>
    </div>
  );
}
