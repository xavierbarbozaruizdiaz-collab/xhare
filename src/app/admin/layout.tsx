'use client';

import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { AdminAuthProvider, useAdminAuth } from './AdminAuthContext';
import { APP_NAME_ADMIN } from '@/lib/brand';

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
    { href: '/admin/dispatch-map', label: 'Mapa despacho' },
    { href: '/admin/demand-groups', label: 'Grupos demanda' },
    { href: '/admin/demand-grouping', label: 'Agrupación' },
    { href: '/admin/corridors', label: 'Corredores' },
    { href: '/admin/pricing', label: 'Pricing' },
    { href: '/admin/drivers', label: 'Conductores' },
    { href: '/admin/billing', label: 'Billing' },
    { href: '/admin/passengers', label: 'Pasajeros' },
    { href: '/admin/rides', label: 'Viajes' },
    { href: '/admin/ratings', label: 'Calificaciones' },
    { href: '/admin/users', label: 'Usuarios' },
    { href: '/admin/legal-audit', label: 'Legal' },
    { href: '/admin/settings', label: 'Config' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-3 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-3 min-w-0">
            <Link href="/admin" className="text-lg font-bold text-[#20A050] whitespace-nowrap min-w-0 truncate">
              {APP_NAME_ADMIN}
            </Link>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Link href="/" className="text-sm text-gray-500 hover:text-green-600 whitespace-nowrap">
                Ver app
              </Link>
              <button
                type="button"
                onClick={() => supabase.auth.signOut().then(() => { window.location.href = '/'; })}
                className="btn-secondary text-sm py-2"
              >
                Cerrar sesión
              </button>
            </div>
          </div>
          {/* min-w-0: el flex no hereda el ancho del contenido; overflow-x + touch-pan-x: deslizar en móvil */}
          <div className="w-full min-w-0 -mx-1 px-1 sm:mx-0 sm:px-0">
            <nav
              className="flex w-full min-w-0 max-w-full flex-nowrap gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x pb-2 min-h-[44px] items-center [scrollbar-width:thin] [-webkit-overflow-scrolling:touch]"
              aria-label="Navegación administración"
            >
              {nav.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className={`tab-segment flex-shrink-0 ${
                    pathname === href || (href !== '/admin' && pathname.startsWith(href + '/'))
                      ? 'tab-segment-active'
                      : ''
                  }`}
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">
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
