'use client';

import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase/client';
import { registerForPush, sendTokenToBackend } from '@/lib/capacitor/pushNotifications';

const PUSH_DENIED_KEY = 'xhare_push_permission_denied';

/** En emulador/dev (10.0.2.2 o localhost) no registrar push para evitar crash si FCM no está configurado. */
function isLikelyDevOrEmulator(): boolean {
  if (typeof window === 'undefined') return true;
  const o = window.location?.origin ?? '';
  return o.includes('10.0.2.2') || o.includes('localhost') || o.includes('127.0.0.1');
}

/**
 * En dispositivos nativos (Android/iOS), al haber sesión registra el token FCM/APNS
 * en el backend. No vuelve a mostrar el diálogo de permiso si el usuario ya rechazó esta sesión.
 */
export default function PushRegistration() {
  const registeredForUser = useRef<string | null>(null);
  const alreadyAskedRef = useRef(false);

  const register = async () => {
    if (typeof window === 'undefined') return;
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform() || isLikelyDevOrEmulator()) return;
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(PUSH_DENIED_KEY) === '1') return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token || session.user.id === registeredForUser.current) return;
    if (alreadyAskedRef.current) return;

    alreadyAskedRef.current = true;
    const result = await registerForPush();
    if (!result.ok) {
      if (result.error === 'permission_denied' && typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(PUSH_DENIED_KEY, '1');
      }
      return;
    }
    if (!result.token) return;

    const platform = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
    const sent = await sendTokenToBackend(result.token, platform, session.access_token);
    if (sent) registeredForUser.current = session.user.id;
  };

  useEffect(() => {
    const t = setTimeout(() => {
      register().catch(() => {});
    }, 3000);
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && !alreadyAskedRef.current) register().catch(() => {});
    });
    return () => {
      clearTimeout(t);
      subscription.unsubscribe();
    };
  }, []);

  return null;
}
