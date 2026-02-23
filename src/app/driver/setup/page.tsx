'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SEAT_COUNT_OPTIONS } from '@/lib/seat-layout';

export default function DriverSetupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [profile, setProfile] = useState<{
    role: string;
    vehicle_model?: string | null;
    vehicle_year?: number | null;
    vehicle_seat_count?: number | null;
    vehicle_seat_layout?: unknown;
  } | null>(null);
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleYear, setVehicleYear] = useState('');
  const [seatCount, setSeatCount] = useState(6);
  const [migrationMissing, setMigrationMissing] = useState(false);

  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      let { data, error } = await supabase
        .from('profiles')
        .select('role, vehicle_model, vehicle_year, vehicle_seat_count, vehicle_seat_layout, driver_approved_at')
        .eq('id', user.id)
        .maybeSingle();
      if (error?.code === '42703' || error?.message?.includes('column')) {
        const res = await supabase.from('profiles').select('role, vehicle_model, vehicle_year, driver_approved_at').eq('id', user.id).maybeSingle();
        data = res.data ? { ...res.data, vehicle_seat_count: null, vehicle_seat_layout: null } : res.data;
        error = res.error;
        setMigrationMissing(true);
      }
      if (error || !data) {
        router.push('/');
        return;
      }
      // Si llegó como passenger es porque se registró como conductor pero la API no corrigió a tiempo: forzar corrección
      if (data.role === 'passenger') {
        const session = (await supabase.auth.getSession()).data?.session?.access_token;
        if (session) {
          await fetch('/api/auth/ensure-driver-pending', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ access_token: session }),
          });
          const res = await supabase.from('profiles').select('role, vehicle_model, vehicle_year, vehicle_seat_count, vehicle_seat_layout, driver_approved_at').eq('id', user.id).maybeSingle();
          data = res.data ?? data;
        }
      }
      const approved = (data as { driver_approved_at?: string | null }).driver_approved_at;
      const isDriverApproved = data.role === 'driver' && approved;
      const isDriverPending = data.role === 'driver_pending';
      if (!isDriverApproved && !isDriverPending) {
        router.push(data.role === 'driver' ? '/driver/pending' : '/');
        return;
      }
      setProfile(data);
      setVehicleModel((data.vehicle_model ?? '').trim());
      setVehicleYear(String(data.vehicle_year ?? ''));
      const count = Math.max(6, (data.vehicle_seat_count as number | null | undefined) ?? 6);
      setSeatCount(count);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !profile) return;
    if (migrationMissing) {
      alert('Para guardar vehículo y asientos, ejecutá la migración en Supabase: SQL Editor → archivo supabase/migrations/011_driver_vehicle_and_seat_layout.sql');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          vehicle_model: vehicleModel.trim() || null,
          vehicle_year: vehicleYear ? parseInt(vehicleYear, 10) : null,
          vehicle_seat_count: seatCount,
          vehicle_seat_layout: null,
        })
        .eq('id', user.id);
      if (error) throw error;
      if (profile?.role === 'driver_pending') {
        router.push('/driver/pending');
        router.refresh();
        return;
      }
      router.push('/publish');
      router.refresh();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="container mx-auto flex justify-between items-center">
          <Link href="/" className="text-2xl font-bold text-green-600">Xhare</Link>
          <Link href="/my-rides" className="text-gray-600 hover:text-green-600 font-medium">Mis viajes</Link>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Configuración de conductor</h1>
        {migrationMissing && (
          <div className="mb-4 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm">
            <p className="font-medium">Falta aplicar la migración de vehículo y asientos.</p>
            <p className="mt-1">En Supabase → SQL Editor, ejecutá el contenido de <code className="bg-amber-100 px-1 rounded">supabase/migrations/011_driver_vehicle_and_seat_layout.sql</code>. Después recargá esta página.</p>
          </div>
        )}
        <p className="text-gray-600 mb-6">
          Indicá el vehículo que usás y cuántos asientos tenés disponibles.
        </p>

        <form onSubmit={handleSubmit} className="space-y-6 bg-white rounded-xl border border-gray-200 p-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Vehículo (modelo o nombre)</label>
            <input
              type="text"
              value={vehicleModel}
              onChange={(e) => setVehicleModel(e.target.value)}
              placeholder="Ej. Hyundai County, Mercedes Sprinter"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Año (opcional)</label>
            <input
              type="text"
              inputMode="numeric"
              value={vehicleYear}
              onChange={(e) => setVehicleYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="Ej. 2022"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Cantidad de asientos</label>
            <select
              value={seatCount}
              onChange={(e) => setSeatCount(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            >
              {SEAT_COUNT_OPTIONS.map((n) => (
                <option key={n} value={n}>{n} asientos</option>
              ))}
            </select>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-3 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {submitting ? 'Guardando...' : 'Guardar y continuar'}
            </button>
            <Link
              href="/my-rides"
              className="px-4 py-3 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50"
            >
              Omitir por ahora
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
