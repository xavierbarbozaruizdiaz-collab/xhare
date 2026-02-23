'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';

const KEY = 'driver_pending_instructions';

export default function AdminSettingsPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('settings').select('value').eq('key', KEY).maybeSingle();
      const v = (data?.value as { email?: string; message?: string }) ?? {};
      setEmail(typeof v.email === 'string' ? v.email : '');
      setMessage(typeof v.message === 'string' ? v.message : '');
    })().finally(() => setLoading(false));
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
    </div>
  );
}
