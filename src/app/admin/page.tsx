'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<{
    pendingDrivers: number;
    totalDrivers: number;
    totalPassengersProfile: number;
    totalRides: number;
  }>({
    pendingDrivers: 0,
    totalDrivers: 0,
    totalPassengersProfile: 0,
    totalRides: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [profilesRes, ridesRes] = await Promise.all([
        supabase.from('profiles').select('role'),
        supabase.from('rides').select('id', { count: 'exact', head: true }),
      ]);
      const profiles = profilesRes.data ?? [];
      setStats({
        pendingDrivers: profiles.filter((p) => p.role === 'driver_pending').length,
        totalDrivers: profiles.filter((p) => p.role === 'driver').length,
        totalPassengersProfile: profiles.filter((p) => p.role === 'passenger').length,
        totalRides: ridesRes.count ?? 0,
      });
      setLoading(false);
    })();
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Panel de administración</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Link
          href="/admin/drivers"
          className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm hover:border-green-300 hover:shadow transition"
        >
          <p className="text-gray-500 text-sm">Solicitudes de conductores</p>
          <p className="text-2xl font-bold text-gray-900">{loading ? '—' : stats.pendingDrivers}</p>
          <p className="text-xs text-green-600 mt-1">Aprobar o rechazar</p>
        </Link>
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <p className="text-gray-500 text-sm">Conductores aprobados</p>
          <p className="text-2xl font-bold text-gray-900">{loading ? '—' : stats.totalDrivers}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <p className="text-gray-500 text-sm">Pasajeros</p>
          <p className="text-2xl font-bold text-gray-900">{loading ? '—' : stats.totalPassengersProfile}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <p className="text-gray-500 text-sm">Viajes</p>
          <p className="text-2xl font-bold text-gray-900">{loading ? '—' : stats.totalRides}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-900 mb-2">Accesos rápidos</h2>
        <ul className="space-y-2 text-sm">
          <li>
            <Link href="/admin/drivers" className="text-green-600 hover:underline">
              Solicitudes de conductores
            </Link>
            — Aprobar o rechazar registros como chofer
          </li>
          <li>
            <Link href="/admin/passengers" className="text-green-600 hover:underline">
              Pasajeros
            </Link>
            — Listado de usuarios pasajeros
          </li>
          <li>
            <Link href="/admin/rides" className="text-green-600 hover:underline">
              Viajes
            </Link>
            — Todos los viajes publicados
          </li>
          <li>
            <Link href="/admin/users" className="text-green-600 hover:underline">
              Usuarios
            </Link>
            — Todos los usuarios y roles
          </li>
        </ul>
      </div>
    </div>
  );
}
