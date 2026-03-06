'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { invalidatePricingCache } from '@/lib/pricing/runtime-pricing';

type PricingRow = {
  id: string;
  min_fare_100: number;
  pyg_per_km_100: number;
  discount_percent: number;
  round_to: number;
  block_size: number;
  block_multiplier: number;
  driver_fee_per_completed_ride: number;
  driver_debt_limit_default: number;
  is_active: boolean;
  created_at: string;
};

export default function AdminPricingPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [active, setActive] = useState<PricingRow | null>(null);
  const [form, setForm] = useState({
    min_fare_100: 11900,
    pyg_per_km_100: 4634,
    discount_percent: 0,
    round_to: 100,
    block_size: 4,
    block_multiplier: 1.5,
    driver_fee_per_completed_ride: 2000,
    driver_debt_limit_default: 50000,
  });

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('pricing_settings')
      .select('*')
      .eq('is_active', true)
      .maybeSingle();
    setActive((data as PricingRow) ?? null);
    if (data) {
      setForm({
        min_fare_100: (data as PricingRow).min_fare_100 ?? 11900,
        pyg_per_km_100: (data as PricingRow).pyg_per_km_100 ?? 4634,
        discount_percent: (data as PricingRow).discount_percent ?? 0,
        round_to: (data as PricingRow).round_to ?? 100,
        block_size: (data as PricingRow).block_size ?? 4,
        block_multiplier: Number((data as PricingRow).block_multiplier ?? 1.5),
        driver_fee_per_completed_ride: (data as PricingRow).driver_fee_per_completed_ride ?? 2000,
        driver_debt_limit_default: (data as PricingRow).driver_debt_limit_default ?? 50000,
      });
    }
    setLoading(false);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (active?.id) {
        const { error } = await supabase
          .from('pricing_settings')
          .update({
            min_fare_100: form.min_fare_100,
            pyg_per_km_100: form.pyg_per_km_100,
            discount_percent: form.discount_percent,
            round_to: form.round_to,
            block_size: form.block_size,
            block_multiplier: form.block_multiplier,
            driver_fee_per_completed_ride: form.driver_fee_per_completed_ride,
            driver_debt_limit_default: form.driver_debt_limit_default,
          })
          .eq('id', active.id);
        if (error) throw error;
      } else {
        const { data: rows } = await supabase.from('pricing_settings').select('id');
        for (const r of rows ?? []) {
          await supabase.from('pricing_settings').update({ is_active: false }).eq('id', r.id);
        }
        const { error } = await supabase.from('pricing_settings').insert({
          ...form,
          is_active: true,
        });
        if (error) throw error;
      }
      invalidatePricingCache();
      await load();
    } catch (err: any) {
      alert(err?.message ?? 'Error al guardar');
    } finally {
      setSaving(false);
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
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Pricing</h1>
      <p className="text-gray-600 mb-6">
        Valores 100% y descuento para la tarifa efectiva. Si no hay fila activa, la app usa fallback (7140 / 2780 PYG, block 4, 1.5×, round 100).
      </p>

      <form onSubmit={handleSave} className="bg-white rounded-xl border border-gray-200 p-6 max-w-xl space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Min fare 100% (PYG)</label>
            <input
              type="number"
              min={0}
              value={form.min_fare_100}
              onChange={(e) => setForm((f) => ({ ...f, min_fare_100: parseInt(e.target.value, 10) || 0 }))}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">PYG/km 100%</label>
            <input
              type="number"
              min={0}
              value={form.pyg_per_km_100}
              onChange={(e) => setForm((f) => ({ ...f, pyg_per_km_100: parseInt(e.target.value, 10) || 0 }))}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Descuento % (0–100)</label>
          <input
            type="number"
            min={0}
            max={100}
            value={form.discount_percent}
            onChange={(e) => setForm((f) => ({ ...f, discount_percent: parseInt(e.target.value, 10) || 0 }))}
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Redondeo (PYG)</label>
            <input
              type="number"
              min={1}
              value={form.round_to}
              onChange={(e) => setForm((f) => ({ ...f, round_to: parseInt(e.target.value, 10) || 100 }))}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Block size (asientos)</label>
            <input
              type="number"
              min={1}
              value={form.block_size}
              onChange={(e) => setForm((f) => ({ ...f, block_size: parseInt(e.target.value, 10) || 4 }))}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Block multiplier</label>
          <input
            type="number"
            step={0.1}
            min={0.1}
            value={form.block_multiplier}
            onChange={(e) => setForm((f) => ({ ...f, block_multiplier: parseFloat(e.target.value) || 1.5 }))}
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fee por viaje completado (PYG)</label>
            <input
              type="number"
              min={0}
              value={form.driver_fee_per_completed_ride}
              onChange={(e) => setForm((f) => ({ ...f, driver_fee_per_completed_ride: parseInt(e.target.value, 10) || 0 }))}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Límite deuda default (PYG)</label>
            <input
              type="number"
              min={0}
              value={form.driver_debt_limit_default}
              onChange={(e) => setForm((f) => ({ ...f, driver_debt_limit_default: parseInt(e.target.value, 10) || 0 }))}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
        >
          {saving ? 'Guardando...' : active ? 'Actualizar activo' : 'Crear y activar'}
        </button>
      </form>
    </div>
  );
}
