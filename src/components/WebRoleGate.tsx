'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';

const MOBILE_ROLES = new Set(['passenger', 'driver', 'driver_pending']);

function isPublicPath(pathname: string): boolean {
  if (pathname === '/' || pathname === '/login' || pathname === '/descargar') return true;
  if (pathname.startsWith('/legal')) return true;
  return false;
}

export default function WebRoleGate() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;

    const enforce = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled || !session?.user?.id) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .maybeSingle();

      if (cancelled) return;
      const role = String(profile?.role ?? '').trim();
      if (!MOBILE_ROLES.has(role)) return;
      if (isPublicPath(pathname)) return;

      router.replace('/descargar');
    };

    void enforce();
    const { data } = supabase.auth.onAuthStateChange(() => {
      void enforce();
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [pathname, router]);

  return null;
}
