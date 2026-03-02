'use client';

import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { AdminAuthProvider, useAdminAuth } from './AdminAuthContext';

function AdminLayoutInner({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { ready, isAdmin } = useAdminAuth();

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600" />
      </div>
    );
  }

  if (!isAdmin) return null;

  const nav = [
    { href: '/admin', label: 'Inicio' },
    { href: '/admin/drivers', label: 'Conductores' },
    { href: '/admin/passengers', label: 'Pasajeros' },
    { href: '/admin/rides', label: 'Viajes' },
    { href: '/admin/users', label: 'Usuarios' },
    { href: '/admin/settings', label: 'Config' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 app-mobile-shell">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm app-mobile-header">
        <div className="max-w-6xl mx-auto app-mobile-px py-3">
          <div className="flex items-center justify-between gap-2 mb-3">
            <Link href="/admin" className="text-lg font-bold text-green-600 whitespace-nowrap">Xhare Admin</Link>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Link href="/" className="text-sm text-gray-500 hover:text-green-600 whitespace-nowrap">Ver app</Link>
              <button
                type="button"
                onClick={() => supabase.auth.signOut().then(() => router.push('/'))}
                className="btn-secondary text-sm py-2"
              >
                Cerrar sesión
              </button>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto pb-1 -mx-1 scrollbar-thin min-h-[44px] items-center" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            {nav.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`tab-segment flex-shrink-0 ${pathname === href ? 'tab-segment-active' : ''}`}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="max-w-6xl mx-auto app-mobile-px py-6 app-mobile-section">
        {children}
      </main>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminAuthProvider>
      <AdminLayoutInner>{children}</AdminLayoutInner>
    </AdminAuthProvider>
  );
}
