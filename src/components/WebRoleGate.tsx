'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import {
  driverNeedsVehicleSetup,
  resolveWebPostAuthPath,
  WEB_POST_AUTH_PROFILE_SELECT,
} from '@/lib/web-post-auth-redirect';

const MOBILE_ROLES = new Set(['passenger', 'driver', 'driver_pending']);

const DRIVER_ONBOARDING_PREFIXES = ['/driver/setup', '/driver/pending'];

function isPublicPath(pathname: string, role?: string): boolean {
  if (pathname === '/' || pathname === '/login' || pathname === '/descargar') return true;
  if (pathname.startsWith('/legal')) return true;
  if (role === 'driver' || role === 'driver_pending') {
    if (DRIVER_ONBOARDING_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      return true;
    }
  }
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
        .select(WEB_POST_AUTH_PROFILE_SELECT)
        .eq('id', session.user.id)
        .maybeSingle();

      if (cancelled) return;
      const role = String(profile?.role ?? '').trim();
      if (!MOBILE_ROLES.has(role)) return;
      if (isPublicPath(pathname, role)) return;

      if (profile && (role === 'driver' || role === 'driver_pending') && driverNeedsVehicleSetup(profile)) {
        router.replace('/driver/setup');
        return;
      }

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
