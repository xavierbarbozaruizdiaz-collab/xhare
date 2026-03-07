'use client';

import Link from 'next/link';
import { useAdminAuth } from './AdminAuthContext';

export default function AdminDashboardPage() {
  const { ready, isAdmin } = useAdminAuth();

  if (!ready) {
    return (
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-gray-900 mb-6">Panel de administración</h1>
        <p className="text-gray-500">Cargando…</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-gray-900 mb-6">Panel de administración</h1>
        <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-6 text-center">
          <p className="text-gray-700">Tu usuario debe tener rol administrador en la base de datos.</p>
          <div className="mt-5 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/login?next=/admin" className="btn-primary text-sm">
              Iniciar sesión
            </Link>
            <Link href="/admin" className="text-sm text-green-600 hover:text-green-700 font-medium">
              Reintentar
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl md:text-2xl font-bold text-gray-900 mb-6">Panel de administración</h1>

      <div className="app-mobile-card p-6">
        <h2 className="font-semibold text-gray-900 mb-2">Accesos rápidos</h2>
        <ul className="space-y-2 text-sm">
          <li>
            <Link href="/admin/drivers" className="text-green-600 hover:underline">
              Solicitudes de conductores
            </Link>
            — Aprobar o rechazar
          </li>
          <li>
            <Link href="/admin/passengers" className="text-green-600 hover:underline">
              Pasajeros
            </Link>
          </li>
          <li>
            <Link href="/admin/rides" className="text-green-600 hover:underline">
              Viajes
            </Link>
          </li>
          <li>
            <Link href="/admin/users" className="text-green-600 hover:underline">
              Usuarios
            </Link>
          </li>
        </ul>
      </div>
    </div>
  );
}
